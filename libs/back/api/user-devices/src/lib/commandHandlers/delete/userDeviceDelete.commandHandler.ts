import { CommandHandler } from '@nestjs/cqrs';
import { BaseCommandHandler, PrismaService, UserDeviceDeleteCommand } from '@seed/back/api/shared';
import { UserDevice } from '@prisma/client';

@CommandHandler(UserDeviceDeleteCommand)
export class UserDeviceDeleteCommandHandler extends BaseCommandHandler<UserDeviceDeleteCommand> {
  constructor(readonly prisma: PrismaService) {
    super();
  }

  async execute(command: UserDeviceDeleteCommand): Promise<null | UserDevice> {
    const existingUserDevice = await this.prisma.userDevice.findFirst({
      where: {
        id: command.id,
        userId: command.currentUserId,
      },
    });
    if (!existingUserDevice) {
      return null;
    }
    return this.prisma.userDevice.delete({
      where: {
        id: command.id,
      },
    });
  }
}
