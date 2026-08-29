import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { VerificationService } from './verification.service';
import { CreateVerificationDto } from './dto/create-verification.dto';
import { UpdateVerificationDto } from './dto/update-verification.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/verification-requests')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get()
  @ApiOperation({ summary: 'List pharmacy verification requests' })
  list() {
    return this.verification.list();
  }

  @Get(':id/document')
  @ApiOperation({
    summary: 'Download the licence document attached to a verification request',
    description:
      'Streamed from the database, never a public storage URL. SUPER_ADMIN only, like every route on this controller — a licence document is not something to hand out by link.',
  })
  async document(@Param('id') id: string, @Res() res: Response) {
    const document = await this.verification.getDocument(id);
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Length', String(document.data.length));
    // `inline` so a reviewer can read it in the browser; the filename is the
    // sanitised one stored at upload, quoted so it cannot break the header.
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${document.filename.replace(/"/g, '')}"`,
    );
    // A licence document must not sit in a shared cache.
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(document.data);
  }

  @Post()
  @ApiOperation({ summary: 'Create a verification request' })
  create(
    @CurrentUser('id') actorId: string,
    @Body() dto: CreateVerificationDto,
  ) {
    return this.verification.create(actorId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Review a request (status / reviewer / note)' })
  update(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVerificationDto,
  ) {
    return this.verification.update(actorId, id, dto);
  }
}
