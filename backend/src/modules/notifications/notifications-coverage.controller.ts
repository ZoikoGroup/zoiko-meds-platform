import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  AUTHORED_TEMPLATES,
  listDirectory,
  listUnauthored,
  SECTION_TITLE,
} from './catalog';
import type { TemplateSection } from './template.types';

/**
 * Read-only coverage reporting for the email template library.
 *
 * The engineering pack forbids declaring a workflow notification-complete until
 * its templates have passed acceptance. This endpoint is how Operations sees
 * what is authored, what is outstanding, and which gates are still closed.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/notifications')
export class NotificationsCoverageController {
  @Get('coverage')
  @ApiOperation({
    summary: 'Template library coverage — authored vs. registered-only',
  })
  coverage() {
    const directory = listDirectory();
    const unauthored = listUnauthored();
    const authoredIds = new Set(AUTHORED_TEMPLATES.map((t) => t.id));

    const sections = new Map<
      TemplateSection,
      { section: string; title: string; total: number; authored: number }
    >();
    for (const row of directory) {
      const entry = sections.get(row.section) ?? {
        section: row.section,
        title: SECTION_TITLE[row.section],
        total: 0,
        authored: 0,
      };
      entry.total += 1;
      if (authoredIds.has(row.id)) entry.authored += 1;
      sections.set(row.section, entry);
    }

    return {
      total: directory.length,
      authored: AUTHORED_TEMPLATES.length,
      outstanding: unauthored.length,
      sections: [...sections.values()],
      outstandingTemplates: unauthored.map((row) => ({
        id: row.id,
        title: row.title,
        gate: row.gate,
      })),
    };
  }
}
