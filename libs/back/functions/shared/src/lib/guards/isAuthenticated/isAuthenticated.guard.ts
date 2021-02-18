import { CanActivate, ExecutionContext } from '@nestjs/common';

export class IsAuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return !!context.switchToHttp().getRequest().userId;
  }
}
