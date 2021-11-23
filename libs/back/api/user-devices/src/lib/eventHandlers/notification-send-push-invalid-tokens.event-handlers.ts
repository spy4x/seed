import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { LogService, PrismaService, NotificationSendPushInvalidTokensEvent } from '@seed/back/api/shared';

@EventsHandler(NotificationSendPushInvalidTokensEvent)
export class NotificationSendPushInvalidTokensEventHandler
  implements IEventHandler<NotificationSendPushInvalidTokensEvent>
{
  private readonly logService = new LogService(NotificationSendPushInvalidTokensEventHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(event: NotificationSendPushInvalidTokensEvent): Promise<void> {
    await this.logService.trackSegment(this.handle.name, async () =>
      this.prisma.userDevice.deleteMany({
        where: {
          fcmToken: {
            in: event.fcmTokens,
          },
        },
      }),
    );
  }
}
