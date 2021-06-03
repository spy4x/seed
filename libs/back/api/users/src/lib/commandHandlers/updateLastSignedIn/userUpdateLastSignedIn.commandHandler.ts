import { CommandHandler, EventBus } from '@nestjs/cqrs';
import {
  BaseCommandHandler,
  PrismaService,
  UserLastSignedInUpdatedEvent,
  UserUpdateLastSignedInCommand,
} from '@seed/back/api/shared';
import { User } from '@prisma/client';

@CommandHandler(UserUpdateLastSignedInCommand)
export class UserUpdateLastSignedInCommandHandler extends BaseCommandHandler<UserUpdateLastSignedInCommand> {
  constructor(readonly prisma: PrismaService, readonly eventBus: EventBus) {
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
