import { CommandHandler } from '@nestjs/cqrs';
import {
  BaseCommandHandler,
  EventBusExt,
  LogService,
  PrismaService,
  UserLastSignedInUpdatedEvent,
  UserUpdateLastSignedInCommand,
} from '@seed/back/api/shared';
import { User } from '@prisma/client';

@CommandHandler(UserUpdateLastSignedInCommand)
export class UserUpdateLastSignedInCommandHandler extends BaseCommandHandler<UserUpdateLastSignedInCommand, User> {
  readonly logger = new LogService(UserUpdateLastSignedInCommandHandler.name);

  constructor(readonly prisma: PrismaService, readonly eventBus: EventBusExt) {
    super();
  }

  async execute(command: UserUpdateLastSignedInCommand): Promise<User> {
    return this.logger.trackSegment(this.execute.name, async logSegment => {
      const nowDate = new Date();
      const updatedUser = await this.prisma.user.update({
        where: {
          id: command.userId,
        },
        data: {
          lastTimeSignedIn: nowDate,
        },
      });

      logSegment.log('Updated user:', updatedUser);
      logSegment.log('Publishing UserLastSignedInUpdatedEvent...');
      this.eventBus.publish(new UserLastSignedInUpdatedEvent(updatedUser));
      return updatedUser;
    });
  }
}
