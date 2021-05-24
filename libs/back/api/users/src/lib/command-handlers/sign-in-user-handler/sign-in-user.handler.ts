import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService, SignInUserCommand, UserSignedInEvent } from '@seed/back/api/shared';

@CommandHandler(SignInUserCommand)
export class SignInUserHandler implements ICommandHandler<SignInUserCommand> {
  constructor(private readonly prisma: PrismaService, private readonly eventBus: EventBus) {}

  async execute(command: SignInUserCommand): Promise<Date | null> {
    const nowDate = new Date();
    const user = await this.prisma.user.update({
      where: {
        id: command.userId,
      },
      data: {
        lastTimeSignedIn: nowDate,
      },
    });

    this.eventBus.publish(new UserSignedInEvent(user));

    return nowDate;
  }
}
