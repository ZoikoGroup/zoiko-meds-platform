import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { isPayloadTooLarge, jsonBodyLimit } from './json-body-limit';

/**
 * The route-scoped body limit for prescription page images.
 *
 * The endpoint that receives them was refusing every realistic request: page
 * images are megabytes of base64 and Nest's global parser stops at 100 kb, so
 * assisted reading failed before validation ever ran — and, because
 * body-parser's error is not an HttpException, it surfaced as a bare 500.
 *
 * Exercised against a real Express server rather than a stubbed request, since
 * what is being asserted is the interaction between two parsers mounted at
 * different paths — the part that a fake req/res cannot show.
 */
describe('jsonBodyLimit', () => {
  let server: Server;
  let baseUrl: string;

  const HINT = 'The prescription images are too large to send.';

  beforeAll(async () => {
    const app = express();

    // Mirrors main.ts: the generous parser is mounted on one path, and the
    // default-limit parser afterwards for everything else — exactly the order
    // Nest produces, since its own parser is registered during listen().
    app.use('/api/scan/vision-extract', jsonBodyLimit('12mb', HINT));
    app.use(express.json());

    app.post('/api/scan/vision-extract', (req, res) => {
      res.json({ images: (req.body as { images?: string[] }).images?.length ?? 0 });
    });
    app.post('/api/auth/login', (req, res) => {
      res.json({ ok: true, email: (req.body as { email?: string }).email });
    });

    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** A page image of roughly the size the client actually produces. */
  const pageImage = (megabytes: number) =>
    `data:image/jpeg;base64,${'A'.repeat(Math.round(megabytes * 1024 * 1024))}`;

  it('accepts a realistic prescription page', async () => {
    // ~1.5 MB is a 2000px JPEG at q0.85 — fifteen times the old ceiling.
    const res = await post('/api/scan/vision-extract', { images: [pageImage(1.5)] });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ images: 1 });
  });

  it('accepts a four-page scan', async () => {
    const res = await post('/api/scan/vision-extract', {
      images: [pageImage(2), pageImage(2), pageImage(2), pageImage(2)],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ images: 4 });
  });

  it('answers 413 — not 500 — when the body is beyond the ceiling', async () => {
    const res = await post('/api/scan/vision-extract', { images: [pageImage(13)] });

    expect(res.status).toBe(413);
  });

  it('says why, in words the client can show', async () => {
    const res = await post('/api/scan/vision-extract', { images: [pageImage(13)] });
    const body = await res.json();

    expect(body).toMatchObject({ statusCode: 413, error: 'Payload Too Large', message: HINT });
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it('keeps a strict ceiling rather than accepting anything', async () => {
    // The point is a bigger limit, not the absence of one.
    const res = await post('/api/scan/vision-extract', { images: [pageImage(20)] });
    expect(res.status).toBe(413);
  });

  it('leaves unrelated endpoints on their own limit', async () => {
    // /auth/login has no business carrying a megabyte, and this change must not
    // give it one.
    const res = await post('/api/auth/login', { email: 'a@b.com', password: 'x'.repeat(200 * 1024) });

    expect(res.status).toBe(413);
  });

  it('still serves a normal request on those endpoints', async () => {
    const res = await post('/api/auth/login', { email: 'a@b.com', password: 'secret' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, email: 'a@b.com' });
  });
});

describe('isPayloadTooLarge', () => {
  it('recognises body-parser’s own signal', () => {
    expect(isPayloadTooLarge({ type: 'entity.too.large' })).toBe(true);
    expect(isPayloadTooLarge({ status: 413 })).toBe(true);
    expect(isPayloadTooLarge({ statusCode: 413 })).toBe(true);
  });

  it('does not claim unrelated failures', () => {
    expect(isPayloadTooLarge({ type: 'entity.parse.failed' })).toBe(false);
    expect(isPayloadTooLarge(new Error('boom'))).toBe(false);
    expect(isPayloadTooLarge(null)).toBe(false);
    expect(isPayloadTooLarge('413')).toBe(false);
  });
});
