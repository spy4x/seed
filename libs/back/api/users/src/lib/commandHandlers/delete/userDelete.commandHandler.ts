import { CommandHandler } from '@nestjs/cqrs';
import { BaseCommandHandler, LogService, PrismaService, UserDeleteCommand } from '@seed/back/api/shared';
import { User } from '@prisma/client';

@CommandHandler(UserDeleteCommand)
export class UserDeleteCommandHandler extends BaseCommandHandler<UserDeleteCommand> {
  readonly logger = new LogService(UserDeleteCommandHandler.name);

  constructor(readonly prisma: PrismaService) {
    super();
  }

  async execute(command: UserDeleteCommand): Promise<User> {
    return this.logger.trackSegment(this.execute.name, async logSegment => {
      const deletedUser = await this.prisma.user.delete({
        where: {
          id: command.id,
        },
      });
      logSegment.log('Deleted user', deletedUser);
      return deletedUser;
    });
  }
}
