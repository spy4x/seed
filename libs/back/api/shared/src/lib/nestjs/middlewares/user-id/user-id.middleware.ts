import { Injectable, NestMiddleware } from '@nestjs/common';
import { Response } from 'express';
import { FirebaseAuthService, LogService } from '../../../services';
import { RequestExtended } from '../../baseClasses';

/**
 * Uses JWT from "request.headers.authorization" to get related userId and save it to req.userId
 */
@Injectable()
export class UserIdMiddleware implements NestMiddleware {
  logService = new LogService(UserIdMiddleware.name);

  constructor(private readonly firebaseAuthService: FirebaseAuthService) {}

  async use(req: RequestExtended, _res: Response, next: () => void): Promise<void> {
    await this.logService.trackSegment(this.use.name, async logSegment => {
      const { authorization } = req.headers;

      if (!authorization) {
        logSegment.log(`Token is not presented`);
        // TODO: context.setUser(null);
        next();
        return;
      }

      const token = authorization.replace('Bearer ', '');

      const userId = await this.firebaseAuthService.validateJWT(token);
      req.userId = userId || undefined;

      logSegment.log(`Token is ${userId ? '' : 'in'}valid.`, { userId, token });

      if (userId) {
        // TODO: context.setUser({ id: userId });
      } else {
        // TODO: context.setUser(null);
      }

      next();
    });
  }
}
