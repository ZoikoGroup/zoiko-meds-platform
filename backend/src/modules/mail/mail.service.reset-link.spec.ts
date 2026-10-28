import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

/**
 * The reset email's link must return to wherever the reset was asked for:
 * the app's own scheme for a request from the Android app (client: 'app'),
 * the SPA URL for a request from the web. Reported as "reset opens the
 * platform instead of the app".
 */

const cfg = (values: Record<string, string>) =>
  ({ get: (k: string) => values[k] }) as unknown as ConfigService;

type SentMail = { html: string; text?: string };

async function sendPasswordReset(
  env: Record<string, string>,
  params: { token: string; client?: 'app' },
): Promise<SentMail> {
  const service = new MailService(cfg(env));
  const sent: SentMail[] = [];
  jest
    .spyOn(service as unknown as { send: (args: SentMail) => Promise<void> }, 'send')
    .mockImplementation(async (args) => {
      sent.push(args);
    });
  await service.sendPasswordReset({ to: 'user@example.com', fullName: 'Ada Lovelace', ...params });
  expect(sent).toHaveLength(1);
  return sent[0];
}

// APP_BASE_URL alone resolves: with no CORS_ORIGIN the configured host is taken
// to be one the API serves the SPA to (see app-urls.ts).
const APP_SCHEME_ENV = {
  APP_BASE_URL: 'https://app.zoikomeds.com',
  MOBILE_OAUTH_REDIRECT: 'com.zoikomeds.app://auth/callback',
};

describe('sendPasswordReset — where the link opens', () => {
  it('points at the web SPA when the request did not come from the app', async () => {
    const { html, text } = await sendPasswordReset(APP_SCHEME_ENV, { token: 'abc' });
    expect(html).toContain('https://app.zoikomeds.com/reset-password?token=abc');
    expect(html).not.toContain('com.zoikomeds.app://');
    expect(text).toContain('https://app.zoikomeds.com/reset-password?token=abc');
    expect(text).not.toContain('com.zoikomeds.app://');
    // No web fallback: the link already is the web.
    expect(html).not.toContain('on a computer?');
    // And no app mark: a reset asked for on the web stays on the web.
    expect(html).not.toContain('client=app');
    expect(text).not.toContain('client=app');
  });

  it('points at the app scheme when the reset was asked for in the app', async () => {
    const { html, text } = await sendPasswordReset(APP_SCHEME_ENV, { token: 'abc', client: 'app' });
    expect(html).toContain('com.zoikomeds.app://auth/reset-password?token=abc');
    // The button, not just the fallback, carries the app link…
    expect(html).toContain(`<a class="btn" href="com.zoikomeds.app://auth/reset-password?token=abc">`);
    // …and a computer-bound reader still gets the web link.
    expect(html).toContain('https://app.zoikomeds.com/reset-password?token=abc');
    expect(text).toContain('com.zoikomeds.app://auth/reset-password?token=abc');
    expect(text).toContain('use this link instead: https://app.zoikomeds.com/reset-password?token=abc');
  });

  it('tells a phone reader the web link is for them too, when the button will not open', async () => {
    // Mail clients often drop links on a custom scheme, leaving the button dead.
    // The fallback used to say it was for computers, so a phone reader had no
    // reason to think it applied to them.
    const { html } = await sendPasswordReset(APP_SCHEME_ENV, { token: 'abc', client: 'app' });
    expect(html).toContain('Button not opening the app, or on a computer?');
  });

  it('marks the web link of an app request, so the reset page can hand back to the app', async () => {
    const { html, text } = await sendPasswordReset(APP_SCHEME_ENV, { token: 'abc', client: 'app' });
    expect(html).toContain('href="https://app.zoikomeds.com/reset-password?token=abc&client=app"');
    expect(text).toContain('https://app.zoikomeds.com/reset-password?token=abc&client=app');
    // The app's own link is untouched: inside the app there is nothing to return to.
    expect(html).toContain('href="com.zoikomeds.app://auth/reset-password?token=abc"');
  });

  it('marks the web link even when it is the only link, because the app is still waiting', async () => {
    // MOBILE_OAUTH_REDIRECT missing: no app link at all, so this web link is
    // what the person on the phone will tap, and the only way back is the mark.
    const { html } = await sendPasswordReset({ APP_BASE_URL: APP_SCHEME_ENV.APP_BASE_URL }, {
      token: 'abc',
      client: 'app',
    });
    expect(html).toContain('/reset-password?token=abc&client=app');
  });

  it('falls back to the web link when the app flow is not configured', async () => {
    // Only MOBILE_OAUTH_REDIRECT is missing: the web base is still set.
    const { html } = await sendPasswordReset({ APP_BASE_URL: APP_SCHEME_ENV.APP_BASE_URL }, {
      token: 'abc',
      client: 'app',
    });
    expect(html).toContain('https://app.zoikomeds.com/reset-password?token=abc');
    expect(html).not.toContain('com.zoikomeds.app://');
  });

  it('encodes the token into the query', async () => {
    const { html } = await sendPasswordReset(APP_SCHEME_ENV, { token: 'a&b=c', client: 'app' });
    expect(html).toContain('com.zoikomeds.app://auth/reset-password?token=a%26b%3Dc');
  });
});
