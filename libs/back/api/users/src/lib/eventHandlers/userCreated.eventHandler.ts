import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import {
  API_CONFIG,
  CloudTaskCreateCommand,
  CloudTasksQueues,
  CommandBusExt,
  LogService,
  UserCreatedEvent,
} from '@seed/back/api/shared';
import { NotificationType } from '@prisma/client';
import { addHours } from 'date-fns';

@EventsHandler(UserCreatedEvent)
export class UserCreatedEventHandler implements IEventHandler<UserCreatedEvent> {
  readonly logger = new LogService(UserCreatedEventHandler.name);

  constructor(readonly commandBus: CommandBusExt) {}

  async handle(event: UserCreatedEvent): Promise<void> {
    await this.logger.trackSegment(this.handle.name, async logSegment => {
      const userId = event.user.id;
      const executeInHours = 6;
      const whenToTrigger = addHours(new Date(), executeInHours);
      logSegment.log(`Creating cloud task for invoking Welcome notification in ${executeInHours} hours...`);
      try {
        await this.commandBus.execute(
          new CloudTaskCreateCommand(
            CloudTasksQueues.welcome,
            userId,
            `${API_CONFIG.apiURL}/notifications/invoke`,
            whenToTrigger,
            {
              type: NotificationType.WELCOME,
              userId,
            },
          ),
        );
      } catch (error: unknown) {
        logSegment.error({
          message: `CloudTask creation failed`,
          error: error as Error,
        });
      }
    });
  }
}
