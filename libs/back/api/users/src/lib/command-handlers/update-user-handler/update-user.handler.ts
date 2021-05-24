import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService, UpdateUserCommand, UserDetailsDto } from '@seed/back/api/shared';

@CommandHandler(UpdateUserCommand)
export class UpdateUserHandler implements ICommandHandler<UpdateUserCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: UpdateUserCommand): Promise<UserDetailsDto | null> {
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
                // eslint-disable-next-line @typescript-eslint/naming-convention
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
