import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestExtended } from '../../middlewares';

export function userIdInner(_data: unknown, context: ExecutionContext): null | string {
  const request: RequestExtended = context.switchToHttp().getRequest();
  return request.userId ?? null;
}

export const UserId = createParamDecorator(userIdInner);
