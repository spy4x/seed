import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { FirebaseAuthService } from '../../services/firebaseAuth/firebaseAuth.service';

export type RequestExtended = Request & { userId?: string };
/**
 * The UserMiddleware takes a token from the request
 * Gets the userId attached to the current token
 * Attaches the userId to the request
 */
@Injectable()
export class UserMiddleware implements NestMiddleware {
  constructor(private firebaseAuthService: FirebaseAuthService) {}

  async use(req: RequestExtended, _res: Response, next: () => void) {
    const token = req.headers.authorization;
    console.log(`UserMiddleware`, { token });

    if (!token || Array.isArray(token)) {
      console.log(`UserMiddleware`, `Token is not presented`);
      Sentry.setUser(null);
      next();
      return;
    }

    const userId = await this.firebaseAuthService.validateJWT(token);
    console.log(`UserMiddleware`, userId ? `Token is valid. User Id: ${userId}.` : 'Token is not valid.');
    req.userId = userId || undefined;

    Sentry.setUser(userId ? { id: userId } : null);
    next();
  }
}
