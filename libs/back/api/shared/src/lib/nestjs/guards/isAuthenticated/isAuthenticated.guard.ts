import { CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { RequestExtended } from '../../middlewares';

export class IsAuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request: RequestExtended = context.switchToHttp().getRequest();
    if (!request.userId) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
