import { CommandHandler } from '@nestjs/cqrs';
import { BaseCommandHandler, LogService, PrismaService, UserDeviceDeleteCommand } from '@seed/back/api/shared';
import { Prisma, UserDevice } from '@prisma/client';

@CommandHandler(UserDeviceDeleteCommand)
export class UserDeviceDeleteCommandHandler extends BaseCommandHandler<UserDeviceDeleteCommand> {
  readonly logger = new LogService(UserDeviceDeleteCommandHandler.name);

  constructor(readonly prisma: PrismaService) {
    super();
  }

  async execute(command: UserDeviceDeleteCommand): Promise<null | UserDevice> {
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

      logSegment.log('Deleting userDevice...');
      const deletedUserDevice = await this.prisma.userDevice.delete({
        where: {
          id: command.id,
        },
      });
      logSegment.log('Deleted userDevice:', deletedUserDevice);
      return deletedUserDevice;
    });
  }
}
