import { BadRequestException } from '@nestjs/common';
import { coordinatesFrom, resolveMapLink } from './map-link';

/**
 * Resolving a Google Maps share link.
 *
 * This endpoint takes a URL from a caller and fetches it, so the host allowlist
 * is the security boundary — without it the API would forward requests anywhere
 * the caller pointed it. That property is tested first and hardest.
 */

const HYD = { latitude: 17.5561, longitude: 78.4181 };

describe('coordinatesFrom', () => {
  it.each([
    ['place URL', 'https://www.google.com/maps/place/Zoiko/@17.5561,78.4181,17z/'],
    ['?q= query', 'https://maps.google.com/?q=17.5561,78.4181'],
    ['pin data', 'https://www.google.com/maps/place/X/data=!3m1!4b1!4m2!3d17.5561!4d78.4181'],
    ['url-encoded', 'https://www.google.com/maps?q=17.5561%2C78.4181'],
  ])('reads a %s', (_label, url) => {
    expect(coordinatesFrom(url)).toEqual(HYD);
  });

  it('finds coordinates in a page body, not just a URL', () => {
    expect(coordinatesFrom('<meta content="...!3d17.5561!4d78.4181...">')).toEqual(HYD);
  });

  it('returns null rather than guessing', () => {
    expect(coordinatesFrom('')).toBeNull();
    expect(coordinatesFrom('https://www.google.com/maps/place/Zoiko')).toBeNull();
    expect(coordinatesFrom('https://maps.google.com/?q=0,0')).toBeNull();
    expect(coordinatesFrom('https://maps.google.com/?q=91,78')).toBeNull();
  });
});

describe('host allowlist', () => {
  const fetchSpy = jest.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    global.fetch = fetchSpy as never;
  });

  it.each([
    ['a non-Google host', 'https://evil.example.com/maps/@17.5,78.4'],
    ['an internal address', 'http://169.254.169.254/latest/meta-data/'],
    ['localhost', 'http://localhost:8000/api/admin/users'],
    ['a lookalike domain', 'https://google.com.evil.example/maps'],
  ])('refuses to fetch %s', async (_label, url) => {
    await expect(resolveMapLink(url)).rejects.toBeInstanceOf(BadRequestException);
    // The decisive assertion: no request was ever made.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['a file URL', 'file:///etc/passwd'],
    ['not a URL at all', 'just some text'],
  ])('refuses %s', async (_label, url) => {
    await expect(resolveMapLink(url)).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers a long-form URL without any network call', async () => {
    await expect(resolveMapLink('https://www.google.com/maps/@17.5561,78.4181,15z')).resolves.toEqual(
      HYD,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows regional Google domains like google.co.in or maps.google.co.uk', async () => {
    await expect(
      resolveMapLink('https://maps.google.co.in/maps/place/Zoiko/@17.5561,78.4181,17z/'),
    ).resolves.toEqual(HYD);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('following a share link', () => {
  beforeEach(() => jest.resetAllMocks());

  it('reads coordinates out of the redirect target', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      headers: new Headers({ location: 'https://www.google.com/maps/place/X/@17.5561,78.4181,17z/' }),
      text: async () => '',
    }) as never;

    await expect(resolveMapLink('https://maps.app.goo.gl/abc')).resolves.toEqual(HYD);
  });

  it('falls back to the page body when the final URL has none', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      headers: new Headers({}),
      text: async () => 'window.APP_INITIALIZATION_STATE=[[[17,!3d17.5561!4d78.4181]]]',
    }) as never;

    await expect(resolveMapLink('https://maps.app.goo.gl/abc')).resolves.toEqual(HYD);
  });

  it('will not follow a redirect off a Google host', async () => {
    // An open redirect on a Google domain must not become a way to reach
    // arbitrary hosts through this endpoint.
    global.fetch = jest.fn().mockResolvedValue({
      headers: new Headers({ location: 'https://evil.example.com/' }),
      text: async () => '',
    }) as never;

    await expect(resolveMapLink('https://maps.app.goo.gl/abc')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reports a link it cannot read rather than hanging on it', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      headers: new Headers({}),
      text: async () => '<html>no coordinates here</html>',
    }) as never;

    await expect(resolveMapLink('https://maps.app.goo.gl/abc')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('surfaces a network failure as a bad request, not a 500', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ENOTFOUND')) as never;

    await expect(resolveMapLink('https://maps.app.goo.gl/abc')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
