import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CloudTasksCreateCommand } from '../commands';
import { CloudTasksService } from '../services';

@CommandHandler(CloudTasksCreateCommand)
export class CloudTasksCreateCommandHandler implements ICommandHandler<CloudTasksCreateCommand> {
  constructor(private readonly cloudTasksService: CloudTasksService) {}

  async execute(command: CloudTasksCreateCommand): Promise<void> {
    return this.cloudTasksService.create(
      command.queueName,
      command.taskId,
      command.urlToTrigger,
      command.whenToTrigger,
      command.payload,
    );
  }
}
