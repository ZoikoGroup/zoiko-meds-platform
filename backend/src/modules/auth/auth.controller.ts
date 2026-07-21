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
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleOAuthGuard, MicrosoftOAuthGuard } from './guards/oauth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { OAuthProfile } from './oauth-profile';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
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
  @ApiOperation({ summary: 'Exchange credentials for a JWT' })
  login(
    @Body() dto: LoginDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.auth.login(dto, ipAddress, userAgent);
  }

  // --- OAuth (Google, Microsoft) ------------------------------------------
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

  @Get('microsoft')
  @UseGuards(MicrosoftOAuthGuard)
  @ApiOperation({ summary: 'Begin Microsoft OAuth sign-in (browser redirect)' })
  microsoftAuth() {
    // The guard redirects to Microsoft; this body never runs.
  }

  @Get('microsoft/callback')
  @UseGuards(MicrosoftOAuthGuard)
  @ApiExcludeEndpoint()
  async microsoftCallback(
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
    const frontend = this.config
      .get<string>('APP_BASE_URL', 'http://localhost:5173')
      .replace(/\/$/, '');
    try {
      const profile = req.user as OAuthProfile | undefined;
      if (!profile) throw new Error('No OAuth profile on request');
      const { accessToken } = await this.auth.oauthLogin(
        profile,
        ipAddress,
        userAgent,
      );
      const target = this.config.get<string>(
        'OAUTH_SUCCESS_REDIRECT',
        `${frontend}/auth/callback`,
      );
      res.redirect(`${target}?token=${encodeURIComponent(accessToken)}`);
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
  @ApiOperation({ summary: 'Set a new password using a reset/invite token' })
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.auth.resetPassword(dto, ipAddress, userAgent);
  }
}

