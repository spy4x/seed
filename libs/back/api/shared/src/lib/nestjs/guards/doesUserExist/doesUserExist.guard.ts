import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { RequestExtended } from '../../baseClasses';

@Injectable()
export class DoesUserExistGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request: RequestExtended = context.switchToHttp().getRequest();
    if (!request.user) {
      throw new ForbiddenException("User doesn't exist in DB. Create user first");
    }
    return true;
  }
}
