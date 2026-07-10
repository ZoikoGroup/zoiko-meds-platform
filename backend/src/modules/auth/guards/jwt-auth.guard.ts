import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Requires a valid Bearer JWT. Attach with @UseGuards(JwtAuthGuard) on any
 * handler or controller that must be authenticated.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
