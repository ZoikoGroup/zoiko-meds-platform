import { Injectable, NotFoundException } from '@nestjs/common';
import { Notification, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async list() {
    const rows = await this.prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((n) => this.toDto(n));
  }

  async create(
    actorId: string,
    actorEmail: string,
    dto: CreateNotificationDto,
    ipAddress?: string,
  ) {
    const notification = await this.prisma.notification.create({
      data: {
        title: dto.title,
        message: dto.message,
        type: dto.type,
        target: dto.target,
        status: dto.status ?? NotificationStatus.DISPATCHED,
        createdBy: actorEmail,
      },
    });
    await this.audit.write(
      actorId,
      'admin.notification.create',
      'Notification',
      notification.id,
      { title: notification.title, target: notification.target },
      ipAddress,
    );
    return this.toDto(notification);
  }

  async remove(actorId: string, id: string, ipAddress?: string) {
    const existing = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Notification not found');
    await this.prisma.notification.delete({ where: { id } });
    await this.audit.write(
      actorId,
      'admin.notification.delete',
      'Notification',
      id,
      undefined,
      ipAddress,
    );
    return { id, deleted: true };
  }

  private toDto(n: Notification) {
    return {
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type,
      target: n.target,
      status: n.status,
      date: n.createdAt,
      createdBy: n.createdBy,
    };
  }
}
