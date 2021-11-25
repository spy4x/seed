import { CanActivate, ExecutionContext } from '@nestjs/common';
import { RequestExtended } from '../../baseClasses';

export class IsAuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request: RequestExtended = context.switchToHttp().getRequest();
    return !!request.userId;
  }
}
