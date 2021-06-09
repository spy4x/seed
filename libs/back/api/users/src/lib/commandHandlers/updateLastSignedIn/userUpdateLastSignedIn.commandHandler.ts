import { CommandHandler } from '@nestjs/cqrs';
import {
  BaseCommandHandler,
  EventBusExt,
  PrismaService,
  UserLastSignedInUpdatedEvent,
  UserUpdateLastSignedInCommand,
} from '@seed/back/api/shared';
import { User } from '@prisma/client';

@CommandHandler(UserUpdateLastSignedInCommand)
export class UserUpdateLastSignedInCommandHandler extends BaseCommandHandler<UserUpdateLastSignedInCommand> {
  constructor(readonly prisma: PrismaService, readonly eventBus: EventBusExt) {
    super();
  }

  async execute(command: UserUpdateLastSignedInCommand): Promise<User> {
    const nowDate = new Date();
    const user = await this.prisma.user.update({
      where: {
        id: command.userId,
      },
      data: {
        lastTimeSignedIn: nowDate,
      },
    });

    this.eventBus.publish(new UserLastSignedInUpdatedEvent(user));

    return user;
  }
}
