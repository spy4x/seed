import * as functions from 'firebase-functions';
import { createUser, User } from '@afs/types';
import { Request, Response } from 'express';

/**
 * Firebase Function that handles HTTPS requests to "/api"
 */
export const api = functions.https.onRequest(
  (request: Request, response: Response): void => {
    const user: User = createUser({});
    response.json(user);
  }
);
