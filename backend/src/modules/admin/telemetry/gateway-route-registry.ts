/**
 * The fixed set of handlers that make up the ZoikoAvail™ governed API surface
 * — the same three scopes PlatformApiKey issues keys for (availability |
 * medibase | signal). Keyed by controller + handler method name rather than
 * read off the request path, so a route is identified by what it is, not by
 * pattern-matching a URL that may carry a dynamic id.
 */
export interface GatewayRouteMeta {
  scope: 'availability' | 'medibase' | 'signal';
  method: string;
  path: string;
  category: string;
  description: string;
}

export const GATEWAY_ROUTES: Record<string, Record<string, GatewayRouteMeta>> = {
  AvailabilityController: {
    get: {
      scope: 'availability',
      method: 'GET',
      path: '/availability',
      category: 'Availability',
      description: 'Governed availability confidence for a medicine.',
    },
  },
  MedibaseController: {
    match: {
      scope: 'medibase',
      method: 'GET',
      path: '/medibase/match',
      category: 'MediBase',
      description: 'Normalized, ranked medicine identity match.',
    },
    lookup: {
      scope: 'medibase',
      method: 'GET',
      path: '/medibase/lookup',
      category: 'MediBase',
      description: 'Resolve a medicine by an external identifier.',
    },
    dictionary: {
      scope: 'medibase',
      method: 'GET',
      path: '/medibase/meta/dictionary',
      category: 'MediBase',
      description: 'MediBase data dictionary (schema contract).',
    },
    findOne: {
      scope: 'medibase',
      method: 'GET',
      path: '/medibase/:id',
      category: 'MediBase',
      description: 'Fetch a medicine identity by id.',
    },
  },
  SignalController: {
    intelligence: {
      scope: 'signal',
      method: 'GET',
      path: '/signal/intelligence',
      category: 'Signal',
      description: 'Time-bucketed, anonymized intelligence cells.',
    },
    summary: {
      scope: 'signal',
      method: 'GET',
      path: '/signal/intelligence/summary',
      category: 'Signal',
      description: 'Aggregate demand / shortage summary over a window.',
    },
    export: {
      scope: 'signal',
      method: 'GET',
      path: '/signal/intelligence/export',
      category: 'Signal',
      description: 'Export anonymized intelligence (JSON or CSV).',
    },
  },
};

/** Every route this catalog knows about, in a stable order for display. */
export const GATEWAY_ROUTE_LIST: GatewayRouteMeta[] = Object.values(GATEWAY_ROUTES).flatMap(
  (handlers) => Object.values(handlers),
);
