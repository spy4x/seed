import { ConflictException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { BaseCommandHandler, PrismaService, UserDeviceCreateCommand } from '@seed/back/api/shared';
import { UserDevice } from '@prisma/client';

@CommandHandler(UserDeviceCreateCommand)
export class UserDeviceCreateCommandHandler extends BaseCommandHandler<UserDeviceCreateCommand> {
  constructor(readonly prisma: PrismaService) {
    super();
  }

  async execute(command: UserDeviceCreateCommand): Promise<UserDevice> {
    const foundDevice = await this.prisma.userDevice.findFirst({
      where: {
        fcmToken: command.fcmToken,
        userId: command.userId,
      },
    });

    if (foundDevice) {
      throw new ConflictException(`Device with that FCMToken is already registered for this user.`);
    }

    return this.prisma.userDevice.create({
      data: command,
    });
  }
}
