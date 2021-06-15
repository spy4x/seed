import { CommandHandler } from '@nestjs/cqrs';
import {
  BaseCommandHandler,
  EventBusExt,
  LogService,
  PrismaService,
  NotificationSendPushCommand,
  NotificationSendPushInvalidTokensEvent,
} from '@seed/back/api/shared';
import { messaging } from 'firebase-admin';

export const FCM_INVALID_TOKENS_ERROR = [
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/mismatched-credential',
];

@CommandHandler(NotificationSendPushCommand)
export class NotificationSendPushCommandHandler extends BaseCommandHandler<NotificationSendPushCommand> {
  readonly messaging = messaging();

  readonly logger = new LogService(NotificationSendPushCommandHandler.name);

  constructor(readonly prisma: PrismaService, readonly eventBus: EventBusExt) {
    super();
  }

  async execute(command: NotificationSendPushCommand): Promise<void> {
    const invalidTokens = await this.sendPushNotification(command);
    if (invalidTokens.length) {
      this.eventBus.publish(new NotificationSendPushInvalidTokensEvent(invalidTokens));
    }
  }

  async sendPushNotification(command: NotificationSendPushCommand): Promise<string[]> {
    return this.logger.trackSegment(
      this.sendPushNotification.name,
      async logSegment => {
        const payload: messaging.MessagingPayload = {
          notification: {
            title: command.title,
            body: command.body,
          },
          data: {
            ...command.notification,
            isRead: command.notification.isRead ? 'true' : 'false',
            createdAt: command.notification.createdAt.toUTCString(),
            updatedAt: command.notification.updatedAt.toUTCString(),
          },
        };

        // Send notifications to all tokens.
        const response = await this.messaging.sendToDevice(command.fcmTokens, payload, {
          mutableContent: true, // let iOS run custom code on push notification arrival. Used to track Analytics events
        });

        const invalidTokens: string[] = [];
        const resultsWithUnhandledErrors: messaging.MessagingDeviceResult[] = [];
        response.results.forEach((result, index) => {
          if (!result.error) return;
          return FCM_INVALID_TOKENS_ERROR.includes(result.error.code)
            ? invalidTokens.push(command.fcmTokens[index])
            : resultsWithUnhandledErrors.push(result);
        });
        let details:
          | undefined
          | {
              invalidTokens?: string[];
              resultsWithUnhandledErrors?: messaging.MessagingDeviceResult[];
            } = undefined;
        if (invalidTokens.length) {
          details = { invalidTokens };
        }
        if (resultsWithUnhandledErrors.length) {
          details = { ...(details || {}), resultsWithUnhandledErrors };
        }
        logSegment.log(`Push notifications has been sent.`, details);

        return invalidTokens;
      },
      command,
    );
  }
}
