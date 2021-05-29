import { CommandHandler } from '@nestjs/cqrs';
import { CloudTaskCreateCommand } from '../commands';
import { CloudTasksService, PrismaService } from '../services';
import { BaseCommandHandler } from '../baseClasses';

@CommandHandler(CloudTaskCreateCommand)
export class CloudTaskCreateCommandHandler extends BaseCommandHandler<CloudTaskCreateCommand> {
  constructor(protected readonly prisma: PrismaService, protected readonly cloudTasksService: CloudTasksService) {
    super(prisma);
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
