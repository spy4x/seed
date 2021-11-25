import { EventBus, IEvent } from '@nestjs/cqrs';
import { LogService } from '../../../services';
import { Injectable } from '@nestjs/common';

@Injectable()
export class EventBusExt {
  readonly logger = new LogService('EventBus');

  constructor(public eventBus: EventBus) {}

  publish(event: IEvent): void {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-assignment */
    const eventName = Object.getPrototypeOf(event)?.constructor?.name;
    void this.logger.trackSegmentSync(
      eventName || 'UnknownEvent',
      () => {
        this.eventBus.publish(event);
      },
      eventName ? { ...event } : event,
    );
  }
}
