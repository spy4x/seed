import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { FirebaseAuthService, LogService } from '../../services';
import { isEnv } from '../../constants';
import { Environment } from '@seed/shared/types';

export type RequestExtended = Request & { userId?: string };

/**
 * The UserMiddleware takes a token from the request
 * Gets the userId attached to the current token
 * Attaches the userId to the request
 */
@Injectable()
export class UserMiddleware implements NestMiddleware {
  logService = new LogService(UserMiddleware.name);

  constructor(private readonly firebaseAuthService: FirebaseAuthService) {}

  async use(req: RequestExtended, _res: Response, next: () => void): Promise<void> {
    await this.logService.trackSegment(this.use.name, async logSegment => {
      const { authorization } = req.headers;

      if (!authorization || Array.isArray(authorization)) {
        logSegment.log(`Token is not presented`);
        Sentry.setUser(null);
        next();
        return;
      }

      logSegment.log(`Token: ${authorization}`);
      const token = authorization.replace('Bearer ', '');

      const userId = isEnv(Environment.development) ? token : await this.firebaseAuthService.validateJWT(token);
      logSegment.log(userId ? `User Id: ${userId}` : 'Token is not valid.');
      req.userId = userId || undefined;

      Sentry.setUser(userId ? { id: userId } : null);
      next();
    });
  }
}
