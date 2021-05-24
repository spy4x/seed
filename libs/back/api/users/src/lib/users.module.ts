import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UserSaga } from './user-saga/user.saga';
import { CreateUserHandler, DeleteUserHandler, SignInUserHandler, UpdateUserHandler } from './command-handlers';
import { FindUsersHandler, GetCurrentUserHandler, GetUserHandler, IsUsernameFreeHandler } from './query-handlers';

const queryHandlers = [FindUsersHandler, GetUserHandler, GetCurrentUserHandler, IsUsernameFreeHandler];
const commandHandlers = [CreateUserHandler, DeleteUserHandler, UpdateUserHandler, SignInUserHandler];

@Module({
  controllers: [UsersController],
  providers: [UserSaga, ...queryHandlers, ...commandHandlers],
})
export class UsersModule {}
