import * as functions from 'firebase-functions';
import { createUser, User } from '@afs/types';

export const api = functions.https.onRequest((request, response) => {
  const user: User = createUser({});
  response.json(user);
});
