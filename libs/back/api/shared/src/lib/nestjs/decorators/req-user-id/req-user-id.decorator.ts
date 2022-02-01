import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestExtended } from '../../baseClasses';

export function reqUserId(_data: unknown, context: ExecutionContext): null | string {
  const request: RequestExtended = context.switchToHttp().getRequest();
  return request.userId ?? null;
}

export const ReqUserId = createParamDecorator(reqUserId);
