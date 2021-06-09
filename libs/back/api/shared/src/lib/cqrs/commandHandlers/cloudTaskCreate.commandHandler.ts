import { CommandHandler } from '@nestjs/cqrs';
import { CloudTaskCreateCommand } from '../commands';
import { CloudTasksService } from '../../services';
import { BaseCommandHandler } from '../baseClasses';

@CommandHandler(CloudTaskCreateCommand)
export class CloudTaskCreateCommandHandler extends BaseCommandHandler<CloudTaskCreateCommand> {
  constructor(readonly cloudTasksService: CloudTasksService) {
    super();
  }

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
