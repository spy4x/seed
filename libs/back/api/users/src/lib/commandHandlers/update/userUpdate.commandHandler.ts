import { CommandHandler } from '@nestjs/cqrs';
import { BaseCommandHandler, LogService, PrismaService, UserUpdateCommand } from '@seed/back/api/shared';
import { User } from '@prisma/client';

@CommandHandler(UserUpdateCommand)
export class UserUpdateCommandHandler extends BaseCommandHandler<UserUpdateCommand, User> {
  readonly logger = new LogService(UserUpdateCommandHandler.name);

  constructor(readonly prisma: PrismaService) {
    super();
  }

  async execute(command: UserUpdateCommand): Promise<User> {
    return this.logger.trackSegment(this.execute.name, async logSegment => {
      const { id, firstName, lastName, userName, photoURL, isPushNotificationsEnabled } = command;
      const updatedUser = await this.prisma.user.update({
        where: {
          id,
        },
        data: {
          userName,
          firstName,
          lastName,
          photoURL,
          isPushNotificationsEnabled,
        },
      });
      logSegment.log('Updated user', updatedUser);
      return updatedUser;
    });
  }
}
