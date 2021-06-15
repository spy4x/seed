import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import {
  UserCreateCommandHandler,
  UserDeleteCommandHandler,
  UserUpdateCommandHandler,
  UserUpdateLastSignedInCommandHandler,
} from './commandHandlers';
import { UserGetQueryHandler, UserIsUsernameFreeQueryHandler, UsersFindQueryHandler } from './queryHandlers';
import { UserCreatedEventHandler } from './eventHandlers/userCreated.eventHandler';

const queryHandlers = [UsersFindQueryHandler, UserGetQueryHandler, UserIsUsernameFreeQueryHandler];
const commandHandlers = [
  UserCreateCommandHandler,
  UserDeleteCommandHandler,
  UserUpdateCommandHandler,
  UserUpdateLastSignedInCommandHandler,
];
const eventHandlers = [UserCreatedEventHandler];

@Module({
  controllers: [UsersController],
  providers: [...queryHandlers, ...commandHandlers, ...eventHandlers],
})
export class UsersModule {}
