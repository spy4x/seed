import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@prisma/client';
import { RequestExtended } from '../../baseClasses';

export function reqUser(_data: unknown, context: ExecutionContext): null | User {
  const request: RequestExtended = context.switchToHttp().getRequest();
  return request.user ?? null;
}

export const ReqUser = createParamDecorator(reqUser);
