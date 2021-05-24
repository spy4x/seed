import { CloudTasksQueues } from '../../constants';
import { ICommand } from '@nestjs/cqrs';

export class CloudTasksCreateCommand implements ICommand {
  constructor(
    public readonly queueName: CloudTasksQueues,
    public readonly taskId: string,
    public readonly urlToTrigger: string,
    public readonly whenToTrigger: Date,
    public readonly payload?: unknown,
  ) {}
}
