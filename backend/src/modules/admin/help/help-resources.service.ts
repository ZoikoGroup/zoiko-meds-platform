import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface HelpResources {
  /** Where to reach support. Always present — this one always exists. */
  supportEmail: string;
  /**
   * The API reference, or null when this deployment does not publish one.
   * Swagger is mounted only outside production, so on the live deployment there
   * is genuinely nothing to open and the console must not offer a link.
   */
  apiReferenceUrl: string | null;
  /** An operator-facing documentation site, when one is configured. */
  documentationUrl: string | null;
}

/**
 * What help this deployment can actually offer (MSA-43).
 *
 * The Help Center's three tiles — Documentation, Keyboard shortcuts, Contact
 * support — were plain buttons with no click handler at all. Two of them are
 * answerable in the client: the shortcuts are the client's own, and support is
 * an address. Documentation is not: whether this deployment publishes an API
 * reference depends on whether Swagger is mounted, which depends on NODE_ENV,
 * and any documentation site is a deployment fact the client cannot know.
 *
 * So the server says what exists, and the console offers only that. A tile that
 * opens a 404 is no better than the one that opened nothing.
 */
@Injectable()
export class HelpResourcesService {
  constructor(private readonly config: ConfigService) {}

  get(): HelpResources {
    return {
      supportEmail:
        this.config.get<string>('SUPPORT_EMAIL') || 'support@zoikomeds.com',
      apiReferenceUrl: this.apiReferenceUrl(),
      documentationUrl: this.config.get<string>('DOCS_URL') || null,
    };
  }

  /**
   * Mirrors main.ts, which mounts Swagger at `${API_PREFIX}/docs` only when
   * NODE_ENV is not production — the full API surface is not published to the
   * internet on the live deployment.
   */
  private apiReferenceUrl(): string | null {
    if (this.config.get<string>('NODE_ENV') === 'production') return null;

    const prefix = this.config.get<string>('API_PREFIX', 'api');
    const base = (this.config.get<string>('API_PUBLIC_URL') || '').replace(/\/$/, '');
    // Relative when no public URL is configured: the console is served from the
    // same origin through its own proxy, so a root-relative path resolves.
    return base ? `${base}/${prefix}/docs` : `/${prefix}/docs`;
  }
}
