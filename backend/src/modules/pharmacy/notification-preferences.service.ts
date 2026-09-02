import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

/**
 * Pharmacy-portal notification preferences.
 *
 * The settings page offers four switches. They were bound to React state and
 * nothing else: flipping one flashed "Notification preferences updated" and the
 * value was gone on the next navigation. Nothing was stored, so nothing could
 * be enforced either — a member who switched system messages off carried on
 * receiving them.
 *
 * This owns both halves of the fix: where the answer is kept, and the single
 * question every delivery path asks before notifying somebody.
 */

/** The categories the portal groups notifications into. */
export type NotificationCategory =
  | 'inventory'
  | 'verification'
  | 'upload'
  | 'system';

export interface NotificationPreferences {
  inventoryAlerts: boolean;
  verificationUpdates: boolean;
  uploadResults: boolean;
  systemMessages: boolean;
}

/**
 * Everything on.
 *
 * Used for an account with no row yet, which is every account that existed
 * before this table. The direction matters: a missing preference must read as
 * "notify me", never as "notify nobody" — the second would silently mute the
 * whole estate the moment this shipped.
 */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  inventoryAlerts: true,
  verificationUpdates: true,
  uploadResults: true,
  systemMessages: true,
};

/** Which stored switch governs which category. */
const CATEGORY_FIELD: Record<NotificationCategory, keyof NotificationPreferences> = {
  inventory: 'inventoryAlerts',
  verification: 'verificationUpdates',
  upload: 'uploadResults',
  system: 'systemMessages',
};

/**
 * The minimum of a Prisma client this gate needs.
 *
 * Typed structurally so it accepts a transaction client as readily as the
 * injected service. Verification review creates its notification inside a
 * transaction, and asking the question outside that transaction would read a
 * row the same transaction might be about to change.
 */
export interface PreferenceReader {
  pharmacyNotificationPreference: {
    // PromiseLike, and no `select`: Prisma's findUnique returns its own thenable
    // whose result type is derived from the arguments, and pinning either here
    // makes the real client — and the transaction client — unassignable.
    findUnique(args: {
      where: { userId: string };
    }): PromiseLike<NotificationPreferences | null>;
  };
}

/**
 * May this account be notified about this category?
 *
 * A free function rather than a method so producers in other modules can call
 * it without importing PharmacyModule — AdminModule already imports it, and the
 * reverse would be a cycle. One implementation, asked by every path.
 */
export async function allowsCategory(
  db: PreferenceReader,
  userId: string,
  category: NotificationCategory,
): Promise<boolean> {
  const row = await db.pharmacyNotificationPreference.findUnique({
    where: { userId },
  });
  const preferences = row ?? DEFAULT_PREFERENCES;
  return preferences[CATEGORY_FIELD[category]];
}

@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  /** This account's preferences, defaulting to everything on. */
  async get(userId: string): Promise<NotificationPreferences> {
    const row = await this.prisma.pharmacyNotificationPreference.findUnique({
      where: { userId },
      select: {
        inventoryAlerts: true,
        verificationUpdates: true,
        uploadResults: true,
        systemMessages: true,
      },
    });
    return row ?? { ...DEFAULT_PREFERENCES };
  }

  /**
   * Save the switches that were sent, leaving the rest alone.
   *
   * A patch, not a replace: the settings page saves one switch at a time, and
   * a replace would reset the other three to whatever the client last rendered.
   */
  async update(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferences> {
    const data = {
      ...(dto.inventoryAlerts !== undefined ? { inventoryAlerts: dto.inventoryAlerts } : {}),
      ...(dto.verificationUpdates !== undefined
        ? { verificationUpdates: dto.verificationUpdates }
        : {}),
      ...(dto.uploadResults !== undefined ? { uploadResults: dto.uploadResults } : {}),
      ...(dto.systemMessages !== undefined ? { systemMessages: dto.systemMessages } : {}),
    };

    const row = await this.prisma.pharmacyNotificationPreference.upsert({
      where: { userId },
      // Create from the defaults so an unsent field starts where it would have
      // been read as, rather than at Prisma's column default by accident.
      create: { userId, ...DEFAULT_PREFERENCES, ...data },
      update: data,
      select: {
        inventoryAlerts: true,
        verificationUpdates: true,
        uploadResults: true,
        systemMessages: true,
      },
    });
    return row;
  }

  /**
   * May this account be notified about this category?
   *
   * The one question every producer and every reader asks. Scoped to a single
   * userId — one member switching a category off must never quieten anybody
   * else's portal.
   */
  async allows(userId: string, category: NotificationCategory): Promise<boolean> {
    return allowsCategory(this.prisma, userId, category);
  }

  /** The categories this account still wants, for filtering a mixed list. */
  async allowedCategories(userId: string): Promise<Set<NotificationCategory>> {
    const preferences = await this.get(userId);
    return new Set(
      (Object.keys(CATEGORY_FIELD) as NotificationCategory[]).filter(
        (category) => preferences[CATEGORY_FIELD[category]],
      ),
    );
  }
}
