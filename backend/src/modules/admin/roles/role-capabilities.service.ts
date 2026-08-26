import { Injectable } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ROLE_LABELS, roleSatisfies } from '../../auth/roles';

export interface RoleCapability {
  /** The controller's route prefix, which is also its id. */
  id: string;
  label: string;
  /** Roles that can reach at least one route here. */
  roles: UserRole[];
  /** How many routes the answer was computed from. */
  routes: number;
  /**
   * True when some routes here are open to anyone, signed in or not. Worth
   * saying: "every role can reach this" and "this needs no account at all" look
   * identical in a matrix of ticks.
   */
  hasPublicRoutes: boolean;
}

export interface RoleMatrix {
  roles: { id: UserRole; label: string }[];
  capabilities: RoleCapability[];
}

/** Every role, in the privilege order the console displays them. */
const ROLE_ORDER: UserRole[] = [
  UserRole.PUBLIC,
  UserRole.PHARMACY_STAFF,
  UserRole.PHARMACY_ADMIN,
  UserRole.ENTERPRISE,
  UserRole.GOVERNMENT,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
];

/**
 * Route prefixes that describe the platform's own plumbing rather than a
 * capability anyone is granted. Listing them would pad the matrix with rows no
 * operator makes a decision about.
 */
const NOT_A_CAPABILITY = new Set(['health', 'auth']);

/** Reads better than the raw prefix, and only where the prefix is not obvious. */
const LABELS: Record<string, string> = {
  admin: 'Platform administration',
  me: 'Patient portal',
  pharmacies: 'Pharmacy portal',
  medibase: 'MediBase catalogue',
  availability: 'Availability signals',
  signal: 'ZoikoSignal intelligence',
  commercial: 'Billing and payments',
  enterprise: 'Enterprise enquiries',
  nearby: 'Nearby pharmacy search',
  scan: 'Prescription scanning',
  search: 'Medicine search',
  notifications: 'Notification delivery',
  integrations: 'Integration status',
};

/**
 * The capability matrix, derived from the guards that actually enforce it
 * (MSA-41 / MSA-43 follow-up).
 *
 * The settings page rendered this from a hand-written table in a frontend
 * fixture. A capability matrix is the sort of thing an operator reads to answer
 * "can a pharmacist see this?", and a hand-written one answers from whenever it
 * was last edited. This walks the controllers, reads the same @Roles metadata
 * RolesGuard reads, and reports what the routes will actually do — so it cannot
 * say a role has access the guard refuses, or the reverse.
 */
@Injectable()
export class RoleCapabilitiesService {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  matrix(): RoleMatrix {
    const byPrefix = new Map<string, { roles: Set<UserRole>; routes: number; open: boolean }>();

    for (const wrapper of this.discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;

      const prefix = this.prefixOf(metatype);
      if (!prefix || NOT_A_CAPABILITY.has(prefix)) continue;

      const classRoles = this.reflector.get<UserRole[]>(ROLES_KEY, metatype) ?? [];
      const classGuards = this.guardsOf(metatype);

      const prototype = Object.getPrototypeOf(instance);
      const methods = this.scanner.getAllMethodNames(prototype);

      for (const method of methods) {
        const handler = prototype[method];
        if (typeof handler !== 'function') continue;
        // A method with no HTTP verb metadata is a helper, not a route.
        if (this.reflector.get(PATH_METADATA, handler) === undefined) continue;

        const handlerRoles = this.reflector.get<UserRole[]>(ROLES_KEY, handler) ?? [];
        const required = handlerRoles.length > 0 ? handlerRoles : classRoles;
        const guarded =
          classGuards.length > 0 || this.guardsOf(handler).length > 0;

        const entry = byPrefix.get(prefix) ?? {
          roles: new Set<UserRole>(),
          routes: 0,
          open: false,
        };
        entry.routes += 1;

        if (required.length === 0) {
          // No role requirement. Either anyone signed in, or — with no guard at
          // all — anyone whatsoever, which is a different fact and recorded as
          // one.
          if (!guarded) entry.open = true;
          ROLE_ORDER.forEach((role) => entry.roles.add(role));
        } else {
          for (const role of ROLE_ORDER) {
            if (required.some((need) => roleSatisfies(role, need))) {
              entry.roles.add(role);
            }
          }
        }
        byPrefix.set(prefix, entry);
      }
    }

    const capabilities: RoleCapability[] = [...byPrefix.entries()]
      .map(([prefix, entry]) => ({
        id: prefix,
        label: LABELS[prefix] ?? this.titleCase(prefix),
        roles: ROLE_ORDER.filter((role) => entry.roles.has(role)),
        routes: entry.routes,
        hasPublicRoutes: entry.open,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      roles: ROLE_ORDER.map((id) => ({ id, label: ROLE_LABELS[id] })),
      capabilities,
    };
  }

  /** The controller's route prefix, normalised to its first segment. */
  private prefixOf(metatype: Function): string | null {
    const path = this.reflector.get<string | string[]>(PATH_METADATA, metatype);
    const first = Array.isArray(path) ? path[0] : path;
    if (typeof first !== 'string') return null;
    const segment = first.replace(/^\/+/, '').split('/')[0];
    return segment || null;
  }

  /** Guards attached with @UseGuards, which Nest stores as class metadata. */
  private guardsOf(target: Function): unknown[] {
    const guards = Reflect.getMetadata('__guards__', target);
    if (!Array.isArray(guards)) return [];
    // JwtAuthGuard is the one that decides "signed in at all"; the rest layer on
    // top of it and do not, on their own, make a route non-public.
    return guards.filter((guard) => guard === JwtAuthGuard || guard?.name !== undefined);
  }

  private titleCase(value: string): string {
    return value
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
