import { Injectable, NestMiddleware } from '@nestjs/common';
import { Response } from 'express';
import { LogService } from '../../../services';
import { User } from '@prisma/client';
import { QueryBusExt, UserGetQuery } from '../../../cqrs';
import { RequestExtended } from '../../baseClasses';

/**
 * Uses "req.userId" to get related User and save it to "req.user".
 */
@Injectable()
export class UserMiddleware implements NestMiddleware {
  logService = new LogService(UserMiddleware.name);

  constructor(private readonly queryBus: QueryBusExt) {}

  async use(req: RequestExtended, _res: Response, next: () => void): Promise<void> {
    await this.logService.trackSegment(this.use.name, async logSegment => {
      const { userId } = req;

      if (!userId) {
        logSegment.log(`req.userId is not presented`);
        next();
        return;
      }

      const user = await this.queryBus.execute<null | User>(new UserGetQuery(userId));
      req.user = user || undefined;

      logSegment.log(`User`, { userId, user });

      if (user) {
        // TODO: context.setUser(user);
      }

      next();
    });
  }
}
