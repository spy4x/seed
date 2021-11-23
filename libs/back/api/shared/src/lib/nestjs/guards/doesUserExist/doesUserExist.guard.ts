import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { User } from '@prisma/client';
import { RequestExtended } from '../../middlewares/user/user.middleware';
import { UserGetQuery } from '../../../cqrs/queries';

@Injectable()
export class DoesUserExistGuard implements CanActivate {
  constructor(private readonly queryBus: QueryBus) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: RequestExtended = context.switchToHttp().getRequest();

    if (!request.userId) {
      return false;
    }

    // TODO: move this part to user.middleware.ts
    const user = await this.queryBus.execute<UserGetQuery, null | User>(new UserGetQuery(request.userId));
    if (!user) {
      throw new ForbiddenException("User doesn't exist in DB. Create user first");
    }

    return true;
  }
}
