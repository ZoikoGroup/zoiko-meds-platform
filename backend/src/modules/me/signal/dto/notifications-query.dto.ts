import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const toNum = ({ value }: { value: unknown }) =>
  value === '' || value == null ? undefined : Number(value);

/**
 * The filter chips on the ZoikoSignal page, as the API sees them.
 *
 * These are the UI type strings the notification DTO already emits, not the
 * database enum: the page's chips are the vocabulary the client speaks, and
 * translating them here keeps the enum an implementation detail on this side of
 * the wire, as it already is for `type` on the way out.
 */
export const NOTIFICATION_FILTERS = [
  'all',
  'unread',
  'running-low',
  'back-in-stock',
  'safety',
] as const;

export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

/**
 * One page of notifications, and which of them.
 *
 * Every field is optional, and that is the compatibility contract: a caller
 * that sends none of them gets the whole list as a bare array, exactly as this
 * endpoint has always answered. Supplying any one of them asks instead for a
 * page — an object carrying the rows, the totals and the per-chip counts.
 *
 * The nav badge and the patient notifications page both read the array form,
 * so widening the shape unconditionally would have changed what they receive
 * for no benefit to either.
 */
export class NotificationsQueryDto {
  /** 1-based. */
  @IsOptional()
  @Transform(toNum)
  @IsInt()
  @Min(1)
  page?: number;

  /**
   * How many rows to return. Capped rather than unbounded: this endpoint
   * regenerates a user's notification set on every read, and an uncapped page
   * size would make "paginated" a way of asking for the whole history again.
   */
  @IsOptional()
  @Transform(toNum)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsIn(NOTIFICATION_FILTERS)
  filter?: NotificationFilter;
}
