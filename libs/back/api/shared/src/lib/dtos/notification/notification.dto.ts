import { Notification, NotificationType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class NotificationDTO implements Notification {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: NotificationType, enumName: 'NotificationType' })
  type: NotificationType;

  @ApiProperty()
  isRead: boolean;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  constructor(id: string, type: NotificationType, isRead: boolean, userId: string, createdAt: Date, updatedAt: Date) {
    this.id = id;
    this.type = type;
    this.isRead = isRead;
    this.userId = userId;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}
