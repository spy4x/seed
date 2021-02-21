import * as functions from 'firebase-functions';
import { UsersController } from '@seed/back/functions/users';
import { getApp } from '@seed/back/functions/core';

let usersController: UsersController;

export const onUserCreate = functions.auth.user().onCreate(async user => {
  try {
    if (!usersController) {
      const { nest } = await getApp();
      usersController = nest.get(UsersController);
    }
    return usersController.onUserCreate(user); // TODO: use CQRS command/event instead of calling controller method
  } catch (e) {
    console.error('Failed to handle user creation', e);
  }
});
