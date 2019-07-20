import * as functions from 'firebase-functions';
import { createUser, User } from '@afs/types';
import { Request, Response } from 'express';

/**
 * Express.Query with name of user for creation
 */
interface QueryWithName {
  /**
   * User name
   */
  name: string;
}

/**
 * Express handler for requests to "/api"
 * @param req Express.Request
 * @param res Express.Response
 */
const httpsHandler = (req: Request, res: Response): void => {
  const user: User = createUser({
    name: (req.query as QueryWithName).name || 'Anton'
  });
  res.json(user);
};

/**
 * Firebase Function for HTTPS onRequest
 */
export const api = functions.https.onRequest(httpsHandler);
