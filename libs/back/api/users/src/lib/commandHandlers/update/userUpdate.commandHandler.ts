import { CommandHandler } from '@nestjs/cqrs';
import { BaseCommandHandler, PrismaService, UserUpdateCommand } from '@seed/back/api/shared';
import { User } from '@prisma/client';

@CommandHandler(UserUpdateCommand)
export class UserUpdateCommandHandler extends BaseCommandHandler<UserUpdateCommand> {
  constructor(readonly prisma: PrismaService) {
    super();
  }

  async execute(command: UserUpdateCommand): Promise<User> {
    const { id, firstName, lastName, userName, photoURL, userDevice, isPushNotificationsEnabled } = command;

    return this.prisma.user.update({
      where: {
        id,
      },
      data: {
        userName,
        firstName,
        lastName,
        photoURL,
        isPushNotificationsEnabled,
        ...(!!userDevice && {
          userDevices: {
            upsert: {
              create: {
                ...userDevice,
              },
              update: {
                ...userDevice,
              },
              where: {
                fcmToken_userId: {
                  fcmToken: userDevice.fcmToken,
                  userId: id,
                },
              },
            },
          },
        }),
      },
    });
  }
}
