import { CommandHandler } from '@nestjs/cqrs';
import { BaseCommandHandler, LogService, PrismaService, UserDeviceUpdateCommand } from '@seed/back/api/shared';
import { Prisma, UserDevice } from '@prisma/client';

@CommandHandler(UserDeviceUpdateCommand)
export class UserDeviceUpdateCommandHandler extends BaseCommandHandler<UserDeviceUpdateCommand> {
  readonly logger = new LogService(UserDeviceUpdateCommandHandler.name);

  constructor(readonly prisma: PrismaService) {
    super();
  }

  async execute(command: UserDeviceUpdateCommand): Promise<null | UserDevice> {
    return this.logger.trackSegment(this.execute.name, async logSegment => {
      const where: Prisma.UserDeviceWhereInput = {
        id: command.id,
        userId: command.currentUserId,
      };
      logSegment.log('Checking for existing userDevice with filter:', where);
      const existingUserDevice = await this.prisma.userDevice.findFirst({
        where,
      });
      logSegment.log('Existing userDevice:', existingUserDevice);
      if (!existingUserDevice) {
        return null;
      }
      /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
      const { id, currentUserId, ...updateData } = command;
      logSegment.log('Updating userDevice...');
      const updatedUserDevice = await this.prisma.userDevice.update({
        where: {
          id: command.id,
        },
        data: updateData,
      });
      logSegment.log('Updated userDevice:', updatedUserDevice);
      return updatedUserDevice;
    });
  }
}
