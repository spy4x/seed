import { ConflictException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import {
  BaseCommandHandler,
  EventBusExt,
  LogService,
  PrismaService,
  UserCreateCommand,
  UserCreatedEvent,
} from '@seed/back/api/shared';
import { Prisma, User } from '@prisma/client';

@CommandHandler(UserCreateCommand)
export class UserCreateCommandHandler extends BaseCommandHandler<UserCreateCommand, User> {
  readonly logger = new LogService(UserCreateCommandHandler.name);

  constructor(readonly prisma: PrismaService, readonly eventBus: EventBusExt) {
    super();
  }

  async execute(command: UserCreateCommand): Promise<User> {
    return this.logger.trackSegment(this.execute.name, async logSegment => {
      const { id, firstName, lastName, userName, photoURL, isPushNotificationsEnabled } = command;

      const where: Prisma.UserWhereInput = {
        OR: [{ userName }, { id }],
      };
      logSegment.log('Checking for existing user:', where);
      const foundUser = await this.prisma.user.findFirst({
        where,
      });
      logSegment.log('Existing user:', foundUser);
      if (foundUser) {
        const message: string[] = [];
        if (foundUser.id === id) {
          message.push('Id already registered');
        }
        if (foundUser.userName === userName) {
          message.push('Username already in use');
        }
        throw new ConflictException(message.join(', '));
      }

      logSegment.log('Creating new user...');
      const user: User = await this.prisma.user.create({
        data: {
          id,
          firstName,
          lastName,
          userName,
          photoURL,
          isPushNotificationsEnabled,
        },
      });
      logSegment.log('Created user:', user);
      logSegment.log('Publishing UserCreatedEvent...');
      this.eventBus.publish(new UserCreatedEvent(user));
      return user;
    });
  }
}
