/**
 * Minimal ambient declaration for `passport-microsoft`, which ships no types.
 * Mirrors the passport-oauth2 verify signature we rely on.
 */
declare module 'passport-microsoft' {
  import { Request } from 'express';

  export interface Profile {
    provider: string;
    id: string;
    displayName?: string;
    name?: { familyName?: string; givenName?: string };
    emails?: Array<{ value: string; type?: string }>;
    _json?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface StrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    scope?: string | string[];
    tenant?: string;
    authorizationURL?: string;
    tokenURL?: string;
    passReqToCallback?: false;
  }

  export type VerifyCallback = (
    error: unknown,
    user?: unknown,
    info?: unknown,
  ) => void;

  export type VerifyFunction = (
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) => void | Promise<void>;

  export class Strategy {
    constructor(options: StrategyOptions, verify: VerifyFunction);
    name: string;
    authenticate(req: Request, options?: unknown): void;
  }
}
