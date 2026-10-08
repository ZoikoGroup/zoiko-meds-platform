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
    expect(html).not.toContain('On a computer?');
  });

  it('points at the app scheme when the reset was asked for in the app', async () => {
    const { html, text } = await sendPasswordReset(APP_SCHEME_ENV, { token: 'abc', client: 'app' });
    expect(html).toContain('com.zoikomeds.app://auth/reset-password?token=abc');
    // The button, not just the fallback, carries the app link…
    expect(html).toContain(`<a class="btn" href="com.zoikomeds.app://auth/reset-password?token=abc">`);
    // …and a computer-bound reader still gets the web link.
    expect(html).toContain('https://app.zoikomeds.com/reset-password?token=abc');
    expect(text).toContain('com.zoikomeds.app://auth/reset-password?token=abc');
    expect(text).toContain('use the web link instead: https://app.zoikomeds.com/reset-password?token=abc');
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
