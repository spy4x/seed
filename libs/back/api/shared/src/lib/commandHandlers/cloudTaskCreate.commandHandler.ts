import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CloudTaskCreateCommand } from '../commands';
import { CloudTasksService } from '../services';

@CommandHandler(CloudTaskCreateCommand)
export class CloudTaskCreateCommandHandler implements ICommandHandler<CloudTaskCreateCommand> {
  constructor(private readonly cloudTasksService: CloudTasksService) {}

  async execute(command: CloudTaskCreateCommand): Promise<void> {
    return this.cloudTasksService.create(
      command.queueName,
      command.taskId,
      command.urlToTrigger,
      command.whenToTrigger,
      command.payload,
    );
  }
}
