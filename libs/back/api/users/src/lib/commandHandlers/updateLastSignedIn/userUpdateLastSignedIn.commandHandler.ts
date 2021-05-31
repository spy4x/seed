import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService, UserUpdateLastSignedInCommand, UserLastSignedInUpdatedEvent } from '@seed/back/api/shared';
import { User } from '@prisma/client';

@CommandHandler(UserUpdateLastSignedInCommand)
export class UserUpdateLastSignedInCommandHandler implements ICommandHandler<UserUpdateLastSignedInCommand> {
  constructor(private readonly prisma: PrismaService, private readonly eventBus: EventBus) {}

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
