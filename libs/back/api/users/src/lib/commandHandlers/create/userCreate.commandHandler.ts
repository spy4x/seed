import { BadRequestException } from '@nestjs/common';
import { CommandHandler, EventBus } from '@nestjs/cqrs';
import { BaseCommandHandler, PrismaService, UserCreateCommand, UserCreatedEvent } from '@seed/back/api/shared';
import { User } from '@prisma/client';

@CommandHandler(UserCreateCommand)
export class UserCreateCommandHandler extends BaseCommandHandler<UserCreateCommand> {
  constructor(readonly prisma: PrismaService, readonly eventBus: EventBus) {
    super();
  }

  async execute(command: UserCreateCommand): Promise<User> {
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

    const user: User = await this.prisma.user.create({
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
