import { NotificationType } from '@prisma/client';

export class NotificationBaseDto {
  id: number;

  createdAt: Date;

  isRead: boolean;

  type: NotificationType;

  constructor(id: number, createdAt: Date, isRead: boolean, type: NotificationType) {
    this.id = id;
    this.createdAt = createdAt;
    this.isRead = isRead;
    this.type = type;
  }
}
