import { Injectable } from '@nestjs/common';
import { ICommand, IEvent, ofType, Saga } from '@nestjs/cqrs';
import { NotificationType } from '@prisma/client';
import { CloudTasksQueues, CloudTasksCreateCommand, API_CONFIG, UserCreatedEvent } from '@seed/back/api/shared';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { addHours } from 'date-fns';

@Injectable()
export class UserSaga {
  @Saga()
  createdSaga = ($events: Observable<IEvent>): Observable<ICommand> => {
    return $events.pipe(
      ofType(UserCreatedEvent),
      map(event => {
        const userId = event.user.id;
        const executeInHours = 6;
        const whenToTrigger = addHours(new Date(), executeInHours);
        return new CloudTasksCreateCommand(
          CloudTasksQueues.welcome,
          userId,
          `${API_CONFIG.apiURL}/notifications/invoke`,
          whenToTrigger,
          {
            type: NotificationType.WELCOME,
            userId,
          },
        );
      }),
    );
  };
}
