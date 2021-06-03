import { Notification } from '@prisma/client';
import { NotificationBaseDto } from './notification-base.dto';

export class NotificationMapper {
  static map(notification: Notification & { isRead: boolean }): NotificationBaseDto {
    switch (notification.type) {
      // case NotificationType.NEW_COMMENT:
      //   return CommentNotificationDto.map(notification as NotificationCommentType);

      default:
        throw new Error(`No dto mapper for notification type ${notification.type} `);
    }
  }
}
