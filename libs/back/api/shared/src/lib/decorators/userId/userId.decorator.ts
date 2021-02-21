import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export function UserIdInner(_data: unknown, context: ExecutionContext): null | string {
  return context.switchToHttp().getRequest().userId;
}

export const UserId = createParamDecorator(UserIdInner);
