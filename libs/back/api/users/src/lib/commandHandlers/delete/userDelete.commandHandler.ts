import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UserDeleteCommand, PrismaService } from '@seed/back/api/shared';
import { User } from '@prisma/client';

@CommandHandler(UserDeleteCommand)
export class UserDeleteCommandHandler implements ICommandHandler<UserDeleteCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: UserDeleteCommand): Promise<User> {
    return this.prisma.user.delete({
      where: {
        id: command.id,
      },
    });
  }
}
