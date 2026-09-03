import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import {
  appBaseUrl,
  oauthSuccessRedirect,
  withQueryParam,
} from '../../config/app-urls';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleOAuthGuard } from './guards/oauth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { OAuthProfile } from './oauth-profile';
import { MfaService } from './mfa/mfa.service';
import {
  MfaCodeDto,
  EmailSecondFactorTokenDto,
  EmailSecondFactorPreferenceDto,
} from './mfa/mfa.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly mfa: MfaService,
  ) {}

  // --- Two-factor authentication (MSA-42) ----------------------------------
  //
  // Enrolment is two calls. `setup` mints a secret and returns the URI to scan;
  // `confirm` proves a code against it, and only then does a factor exist. A
  // setup that is begun and abandoned leaves the account exactly as it was.

  @Get('mfa')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Whether this account has a second factor, and whether the workspace requires one' })
  mfaStatus(@CurrentUser('id') userId: string) {
    return this.mfa.status(userId);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Begin enrolment',
    description:
      'Returns the secret and the otpauth:// URI to scan. Nothing is required of this account until a code is confirmed against it.',
  })
  mfaSetup(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
  ) {
    return this.mfa.beginEnrolment(userId, email);
  }

  @Post('mfa/confirm')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  // Tighter than the sign-in limit: this is a 6-digit secret being guessed
  // against a known account, with a session already in hand.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Confirm enrolment by proving a code' })
  mfaConfirm(
    @CurrentUser('id') userId: string,
    @Body() dto: MfaCodeDto,
    @Ip() ipAddress: string,
  ) {
    return this.mfa.confirmEnrolment(userId, dto.code, ipAddress);
  }

  @Post('mfa/disable')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Turn off the second factor',
    description:
      'Requires a current code: an unattended browser is the situation a second factor exists for, so removing it must not be the one thing a session can do unchallenged. Refused while the workspace requires MFA.',
  })
  mfaDisable(
    @CurrentUser('id') userId: string,
    @Body() dto: MfaCodeDto,
    @Ip() ipAddress: string,
  ) {
    return this.mfa.disable(userId, dto.code, ipAddress);
  }

  // --- Emailed second factor (MSA-42) --------------------------------------
  //
  // The factor a patient or a pharmacy can actually use: no app to install and
  // no enrolment step, because the inbox is one the account already proved it
  // owns. Sign in with a password, open the link, and the session is issued.

  @Get('mfa/email')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Whether this account uses the emailed sign-in link, and whether it may',
  })
  emailFactorStatus(@CurrentUser('id') userId: string) {
    return this.auth.emailSecondFactorStatus(userId);
  }

  @Patch('mfa/email')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Turn the emailed sign-in link on or off',
    description:
      'Chosen by the member and never required of them. Refused for administrator accounts, which use an authenticator app and a workspace policy instead.',
  })
  setEmailFactor(
    @CurrentUser('id') userId: string,
    @Body() dto: EmailSecondFactorPreferenceDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.auth.setEmailSecondFactor(userId, dto.enabled, ipAddress, userAgent);
  }

  @Post('mfa/email/verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Finish a sign-in from the emailed link',
    description:
      'Consumes a single-use token and issues the session. Unauthenticated by design: this call is what produces the session, so requiring one would be circular.',
  })
  // A guessable session is the thing this endpoint must not become. The token
  // is 32 random bytes, so the limit is about denying a sustained attempt
  // rather than a realistic one.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyEmailFactor(
    @Body() dto: EmailSecondFactorTokenDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.auth.completeEmailSecondFactor(dto.token, ipAddress, userAgent);
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a public account and receive a JWT' })
  register(
    @Body() dto: RegisterDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.auth.register(dto, ipAddress, userAgent);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange credentials for a JWT' })
  login(
    @Body() dto: LoginDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.auth.login(dto, ipAddress, userAgent);
  }

  // --- OAuth (Google) -------------------------------------------------------
  // Full-page browser flow: the SPA navigates the browser to /auth/<provider>,
  // the provider redirects back to /auth/<provider>/callback, and we bounce the
  // browser to the frontend with a short-lived JWT in the query string.

  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({ summary: 'Begin Google OAuth sign-in (browser redirect)' })
  googleAuth() {
    // The guard redirects to Google; this body never runs.
  }

  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  @ApiExcludeEndpoint()
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    await this.completeOAuth(req, res, ipAddress, userAgent);
  }

  /** Shared callback tail: issue a session and redirect back to the SPA. */
  private async completeOAuth(
    req: Request,
    res: Response,
    ipAddress: string,
    userAgent: string,
  ) {
    const frontend = appBaseUrl(this.config);
    try {
      const profile = req.user as OAuthProfile | undefined;
      if (!profile) throw new Error('No OAuth profile on request');
      const { accessToken } = await this.auth.oauthLogin(
        profile,
        ipAddress,
        userAgent,
      );
      const target = oauthSuccessRedirect(this.config);
      res.redirect(withQueryParam(target, 'token', accessToken));
    } catch {
      res.redirect(`${frontend}/login?error=oauth`);
    }
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log out and record audit event' })
  logout(
    @CurrentUser('id') userId: string,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.auth.logout(userId, ipAddress, userAgent);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the currently authenticated user' })
  me(@CurrentUser('id') userId: string) {
    return this.auth.me(userId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update your own profile (name, phone)' })
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(userId, dto);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change your own password' })
  changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.auth.changePassword(userId, dto, ipAddress, userAgent);
  }

  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request a password reset link by email' })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.auth.forgotPassword(dto, ipAddress, userAgent);
  }

  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Set a new password using a reset/invite token' })
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.auth.resetPassword(dto, ipAddress, userAgent);
  }
}

