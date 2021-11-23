import { CACHE_MANAGER, Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { Cache } from 'cache-manager';
import { FirebaseAuthService, LogService, LogSegment } from '../../../services';
import { isEnv } from '../../../constants';
import { Environment } from '@seed/shared/types';
import { FIREBASE_AUTH_UID_LENGTH, MINUTES_IN_HOUR, ONE, SECONDS_IN_MINUTE } from '@seed/shared/constants';
import { cacheKeys } from '../../common';

export type RequestExtended = Request & { userId?: string };

/**
 * The UserMiddleware takes an authorization token from the request
 * Gets the userId related to the current token
 * Attaches the userId to the request
 */
@Injectable()
export class UserMiddleware implements NestMiddleware {
  logService = new LogService(UserMiddleware.name);

  constructor(
    private readonly firebaseAuthService: FirebaseAuthService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async use(req: RequestExtended, _res: Response, next: () => void): Promise<void> {
    await this.logService.trackSegment(this.use.name, async logSegment => {
      const { authorization } = req.headers;

      if (!authorization || Array.isArray(authorization)) {
        logSegment.log(`Token is not presented`);
        Sentry.setUser(null);
        next();
        return;
      }

      const token = authorization.replace('Bearer ', '');

      const userId = await this.getUserIdFromToken(token, logSegment);
      logSegment.log(`Token is ${userId ? '' : 'in'}valid.`, { userId, token });
      req.userId = userId || undefined;

      Sentry.setUser(userId ? { id: userId } : null);
      next();
    });
  }

  async getUserIdFromToken(token: string, logSegment: LogSegment): Promise<null | string> {
    // Check if token is userId for dev purposes
    const isDevelopment = isEnv(Environment.development) && token.length <= FIREBASE_AUTH_UID_LENGTH;
    if (isDevelopment) {
      logSegment.warn('Development environment detected.');
      return token;
    }

    // Check cached value
    let userId: undefined | null | string = await this.cache.get<string>(cacheKeys.jwt(token));
    if (userId) {
      logSegment.log('Cached value found.');
      return userId;
    }

    // Get actual value from Firebase Authentication
    logSegment.log('Using Firebase Auth to parse JWT...');
    userId = await this.firebaseAuthService.validateJWT(token);
    if (userId) {
      // Cache value
      const oneHourInSeconds = ONE * MINUTES_IN_HOUR * SECONDS_IN_MINUTE;
      await this.cache.set(cacheKeys.jwt(token), userId, { ttl: oneHourInSeconds });
    }
    return userId;
  }
}
