import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DeleteUserCommand, PrismaService } from '@seed/back/api/shared';

@CommandHandler(DeleteUserCommand)
export class DeleteUserHandler implements ICommandHandler<DeleteUserCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: DeleteUserCommand): Promise<void> {
    void (await this.prisma.user.delete({
      where: {
        id: command.id,
      },
    }));
  }
}
