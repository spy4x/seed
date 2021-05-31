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

@Module({
  controllers: [UsersController],
  providers: [UserCreatedSaga, ...queryHandlers, ...commandHandlers],
})
export class UsersModule {}
