import { ConflictException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { BaseCommandHandler, LogService, PrismaService, UserDeviceCreateCommand } from '@seed/back/api/shared';
import { Prisma, UserDevice } from '@prisma/client';

@CommandHandler(UserDeviceCreateCommand)
export class UserDeviceCreateCommandHandler extends BaseCommandHandler<UserDeviceCreateCommand, UserDevice> {
  readonly logger = new LogService(UserDeviceCreateCommandHandler.name);

  constructor(readonly prisma: PrismaService) {
    super();
  }

  async execute(command: UserDeviceCreateCommand): Promise<UserDevice> {
    return this.logger.trackSegment(this.execute.name, async logSegment => {
      const where: Prisma.UserDeviceWhereInput = {
        fcmToken: command.fcmToken,
        userId: command.userId,
      };
      logSegment.log('Checking for existing userDevice with filter:', where);
      const foundDevice = await this.prisma.userDevice.findFirst({
        where,
      });
      logSegment.log('Existing userDevice:', foundDevice);

      if (foundDevice) {
        throw new ConflictException(`Device with that FCMToken is already registered for this user.`);
      }

      logSegment.log('Creating new userDevice...');
      const createdUserDevice = await this.prisma.userDevice.create({
        data: command,
      });
      logSegment.log('Created userDevice:', createdUserDevice);
      return createdUserDevice;
    });
  }
}
