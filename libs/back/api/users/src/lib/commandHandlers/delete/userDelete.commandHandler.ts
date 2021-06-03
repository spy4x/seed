import { CommandHandler } from '@nestjs/cqrs';
import { BaseCommandHandler, PrismaService, UserDeleteCommand } from '@seed/back/api/shared';
import { User } from '@prisma/client';

@CommandHandler(UserDeleteCommand)
export class UserDeleteCommandHandler extends BaseCommandHandler<UserDeleteCommand> {
  constructor(readonly prisma: PrismaService) {
    super();
  }

  async execute(command: UserDeleteCommand): Promise<User> {
    return this.prisma.user.delete({
      where: {
        id: command.id,
      },
    });
  }
}
