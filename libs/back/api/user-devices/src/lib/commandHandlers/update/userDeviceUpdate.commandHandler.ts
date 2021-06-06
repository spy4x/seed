import { CommandHandler } from '@nestjs/cqrs';
import { BaseCommandHandler, PrismaService, UserDeviceUpdateCommand } from '@seed/back/api/shared';
import { UserDevice } from '@prisma/client';

@CommandHandler(UserDeviceUpdateCommand)
export class UserDeviceUpdateCommandHandler extends BaseCommandHandler<UserDeviceUpdateCommand> {
  constructor(readonly prisma: PrismaService) {
    super();
  }

  async execute(command: UserDeviceUpdateCommand): Promise<null | UserDevice> {
    const existingUserDevice = await this.prisma.userDevice.findFirst({
      where: {
        id: command.id,
        userId: command.currentUserId,
      },
    });
    if (!existingUserDevice) {
      return null;
    }
    /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
    const { id, currentUserId, ...updateData } = command;
    return this.prisma.userDevice.update({
      where: {
        id: command.id,
      },
      data: updateData,
    });
  }
}
