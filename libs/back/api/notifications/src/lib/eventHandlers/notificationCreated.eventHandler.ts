import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import {
  CommandBusExt,
  LogService,
  NotificationCreatedEvent,
  NotificationSendPushCommand,
  PaginationResponseDTO,
  QueryBusExt,
  UserDevicesFindMyQuery,
  UserGetQuery,
} from '@seed/back/api/shared';
import { Notification, NotificationType, User, UserDevice } from '@prisma/client';

@EventsHandler(NotificationCreatedEvent)
export class NotificationCreatedEventHandler implements IEventHandler<NotificationCreatedEvent> {
  readonly logger = new LogService(NotificationCreatedEventHandler.name);

  constructor(readonly queryBus: QueryBusExt, readonly commandBus: CommandBusExt) {}

  async handle(event: NotificationCreatedEvent): Promise<void> {
    await this.logger.trackSegment(this.handle.name, async logSegment => {
      const { notification } = event;
      const { userId } = notification;

      const user = await this.fetchUser(userId);
      if (!user) {
        logSegment.endWithFail(new Error(`User with id "${userId}" doesn't exist for some reason.`));
        return;
      }
      if (!user.isPushNotificationsEnabled) {
        logSegment.log(`User doesn't want to receive push notifications. Stopping execution.`);
        return;
      }

      const userDevices = await this.fetchUserDevices(userId);
      if (!userDevices.length) {
        logSegment.log(`User doesn't have any user devices to send push notifications to. Stopping execution.`);
        return;
      }

      const { title, body } = await this.getNotificationTexts(notification);

      await this.commandBus.execute(
        new NotificationSendPushCommand(
          notification,
          title,
          body,
          userDevices.map(ud => ud.fcmToken),
        ),
      );
    });
  }

  async fetchUser(userId: string): Promise<null | User> {
    return this.logger.trackSegment(
      this.fetchUser.name,
      async logSegment => {
        const user = await this.queryBus.execute<null | User>(new UserGetQuery(userId));
        logSegment.log(`User fetched:`, user);
        return user;
      },
      userId,
    );
  }

  async fetchUserDevices(userId: string): Promise<UserDevice[]> {
    return this.logger.trackSegment(
      this.fetchUserDevices.name,
      async logSegment => {
        const userDevicesPaginationResponseDTO = await this.queryBus.execute<PaginationResponseDTO<UserDevice>>(
          new UserDevicesFindMyQuery(userId),
        );
        logSegment.log(`User devices fetched:`, userDevicesPaginationResponseDTO.data);
        return userDevicesPaginationResponseDTO.data;
      },
      userId,
    );
  }

  async getNotificationTexts(notification: Notification): Promise<{ title: string; body: string }> {
    return this.logger.trackSegment(this.fetchUserDevices.name, () => {
      switch (notification.type) {
        case NotificationType.WELCOME:
          return {
            title: 'Welcome to the app 🙂',
            body: 'Feel free to contact us with any question or share your feedback!',
          };
        case NotificationType.TEST:
          return {
            title: 'Ping Ping 👻',
            body: 'Are you receiving it?',
          };
        default:
          throw new Error(
            `${this.getNotificationTexts.name}(): Unknown NotificationType "${notification.type as unknown as string}"`,
          );
      }
    });
  }
}
