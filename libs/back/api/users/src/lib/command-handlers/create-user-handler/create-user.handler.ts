import { BadRequestException } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { CreateUserCommand, PrismaService, UserDetailsDto, UserCreatedEvent } from '@seed/back/api/shared';

@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(private readonly prisma: PrismaService, private readonly eventBus: EventBus) {}

  async execute(command: CreateUserCommand): Promise<UserDetailsDto | null> {
    const { id, firstName, lastName, userName, userDevice, photoURL, isPushNotificationsEnabled } = command;
    const createUserDevice = userDevice && {
      userDevices: {
        create: {
          ...userDevice,
        },
      },
    };

    const foundUser = await this.prisma.user.findFirst({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        OR: [{ userName }, { id }],
      },
    });
    if (foundUser) {
      const message: string[] = [];
      if (foundUser.id === id) {
        message.push('Id already registered');
      }
      if (foundUser.userName === userName) {
        message.push('Username already in use');
      }
      throw new BadRequestException(message.join(', '));
    }

    const user = await this.prisma.user.create({
      data: {
        id,
        firstName,
        lastName,
        userName,
        photoURL,
        isPushNotificationsEnabled,
        ...createUserDevice,
      },
    });

    this.eventBus.publish(new UserCreatedEvent(user));
    return user;
  }
}
