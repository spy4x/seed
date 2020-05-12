import * as functions from 'firebase-functions';
import { NestApp } from '../nest/app';
import { UsersController } from '@afs/back/functions/users';

let athletesController: UsersController;

export const onUserCreate = functions.auth.user().onCreate(async user => {
  try {
    if (!athletesController) {
      const { nestApp } = await NestApp.getInstance(false);
      athletesController = nestApp.get(UsersController);
    }

    return athletesController.onUserCreate(user);
  } catch (e) {
    console.error('Failed to handle user creation', e);
  }
});
