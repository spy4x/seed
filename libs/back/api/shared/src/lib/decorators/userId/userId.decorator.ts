import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestExtended } from '../../middlewares/user/user.middleware';

export function userIdInner(_data: unknown, context: ExecutionContext): null | string {
  const request: RequestExtended = context.switchToHttp().getRequest();
  return request.userId ?? null;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const UserId = createParamDecorator(userIdInner);
