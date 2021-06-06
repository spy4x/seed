import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UserCreatedSaga } from './sagas/userCreated.saga';
import {
  UserCreateCommandHandler,
  UserDeleteCommandHandler,
  UserUpdateLastSignedInCommandHandler,
  UserUpdateCommandHandler,
} from './commandHandlers';
import {
  UsersFindQueryHandler,
  UserGetMeQueryHandler,
  UserGetQueryHandler,
  UserIsUsernameFreeQueryHandler,
} from './queryHandlers';

const queryHandlers = [
  UsersFindQueryHandler,
  UserGetQueryHandler,
  UserGetMeQueryHandler,
  UserIsUsernameFreeQueryHandler,
];
const commandHandlers = [
  UserCreateCommandHandler,
  UserDeleteCommandHandler,
  UserUpdateCommandHandler,
  UserUpdateLastSignedInCommandHandler,
];
const sagas = [UserCreatedSaga];

@Module({
  controllers: [UsersController],
  providers: [...queryHandlers, ...commandHandlers, ...sagas],
})
export class UsersModule {}
