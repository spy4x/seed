import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { LogService, UserCreatedEvent } from '@seed/back/api/shared';

@EventsHandler(UserCreatedEvent)
export class UserCreatedEventHandler implements IEventHandler<UserCreatedEvent> {
  readonly logger = new LogService(UserCreatedEventHandler.name);

  handle(/*_event: UserCreatedEvent*/): void {
    this.logger.trackSegmentSync(this.handle.name, logSegment => {
      logSegment.log('To be deleted soon');
      // const userId = event.user.id;
      // const executeInHours = 6;
      // const whenToTrigger = addHours(new Date(), executeInHours);
      // logSegment.log(`Creating cloud task for invoking Welcome notification in ${executeInHours} hours...`);
      // try {
      //   await this.commandBus.execute(
      //     new CloudTaskCreateCommand(
      //       CloudTasksQueues.welcome,
      //       userId,
      //       `${API_CONFIG.apiURL}/notifications/invoke`,
      //       whenToTrigger,
      //       {
      //         type: NotificationType.WELCOME,
      //         userId,
      //       },
      //     ),
      //   );
      // } catch (error: unknown) {
      //   logSegment.error({
      //     message: `CloudTask creation failed`,
      //     error: error as Error,
      //   });
      // }
    });
  }
}
