import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ProviderEventStatus } from '@prisma/client';
import { StripeService } from './stripe.service';
import { StripeWebhookService } from './stripe-webhook.service';

/**
 * Stripe webhook endpoint.
 *
 * Unauthenticated by necessity — Stripe calls it — so authenticity rests entirely
 * on signature verification against the raw body. Throttling is skipped because a
 * legitimate burst of provider events must not be rate-limited into retries.
 *
 * Always answers 2xx once an event has been durably recorded, including for
 * duplicates and events that failed processing. Stripe retries any non-2xx, and
 * retrying something already stored would generate noise without changing the
 * outcome; a FAILED event is replayed deliberately by an operator, not by accident.
 */
@ApiTags('commercial')
@Controller('commercial/webhooks')
@SkipThrottle()
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly webhooks: StripeWebhookService,
  ) {}

  @Post('stripe')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header.');
    }
    // Requires rawBody: true on the Nest application. A re-serialized body would
    // not match the signature, so these must be the exact bytes Stripe sent.
    const raw = req.rawBody;
    if (!raw) {
      throw new BadRequestException(
        'Raw request body unavailable; the webhook cannot be verified.',
      );
    }

    let event;
    try {
      event = this.stripe.constructWebhookEvent(raw, signature);
    } catch (err) {
      // Never process an unverified payload: acting on a forged event could create
      // or cancel a real charge.
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Rejected unverified Stripe webhook: ${detail}`);
      throw new BadRequestException('Webhook signature verification failed.');
    }

    const result = await this.webhooks.handle(event);

    return {
      received: true,
      status: result.status,
      duplicate: result.status === ProviderEventStatus.DUPLICATE,
    };
  }
}
