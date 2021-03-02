import * as functions from 'firebase-functions';
import { UsersController } from '@seed/back/api/users';
import { getApp } from '@seed/back/api/core';
import { UserRecord } from 'firebase-functions/lib/providers/auth';
import { LogService } from '@seed/back/api/shared';

let usersController: null | UsersController = null;

async function handler(user: UserRecord): Promise<void> {
  if (!usersController) {
    const { nest } = await getApp();
    usersController = nest.get<UsersController>(UsersController);
  }
  await usersController.onUserCreate(user); // TODO: use CQRS command/event instead of calling controller method
}

export const onUserCreate = functions.auth
  .user()
  .onCreate(async user =>
    new LogService(onUserCreate.name).trackSegment<void>(handler.name, async () => handler(user)),
  );
