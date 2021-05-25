/* eslint-disable @typescript-eslint/no-unused-vars */
import { NotificationType } from '.prisma/client';
import { IEvent } from '@nestjs/cqrs';
import { UserDTO } from '../dtos';

export class NotificationEvent implements IEvent {
  entityId: number | string | null;

  type: NotificationType;

  createdAt: Date;

  receiver?: UserDTO;

  receivers?: { id: string }[];

  constructor(
    entityId: number | string | null,
    type: NotificationType,
    receiverId?: UserDTO,
    createdAt = new Date(),
    receivers?: { id: string }[],
  ) {
    this.entityId = entityId;
    this.type = type;
    this.createdAt = createdAt;
    this.receiver = receiverId;
    this.receivers = receivers;
  }

  getNotification(): { title: string; body: string } {
    throw new Error('getNotification() not implemented');
  }

  getData(): { [key: string]: string } {
    throw new Error('getData() not implemented');
  }
}
