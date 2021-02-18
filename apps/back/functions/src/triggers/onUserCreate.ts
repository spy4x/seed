import * as functions from 'firebase-functions';
import { UsersController } from '@seed/back/functions/users';
import { NestApp } from '@seed/back/functions/core';

let usersController: UsersController;

export const onUserCreate = functions.auth.user().onCreate(async user => {
  try {
    if (!usersController) {
      const { nestApp } = await NestApp.getInstance(false);
      usersController = nestApp.get(UsersController);
      // TODO: use CQRS command/event
    }

    return usersController.onUserCreate(user);
  } catch (e) {
    console.error('Failed to handle user creation', e);
  }
});
