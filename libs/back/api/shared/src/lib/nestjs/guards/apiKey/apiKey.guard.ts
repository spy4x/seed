import { CanActivate, CustomDecorator, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { LogService } from '../../../services';

export const API_KEY_QUERY_SEGMENT_NAME = 'API_KEY';
export const API_KEY_GUARD_TRUE_VALUE_TOKEN = 'API_KEY_GUARD_TRUE_VALUE_TOKEN';
type TrueValue = string;

export const ApiKeyGuardSetTrueValue = (value: TrueValue): CustomDecorator =>
  SetMetadata(API_KEY_GUARD_TRUE_VALUE_TOKEN, value);

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logService = new LogService(ApiKeyGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    return this.logService.trackSegmentSync(this.canActivate.name, logSegment => {
      const request: Request = context.switchToHttp().getRequest();
      const apiKey = request.query[API_KEY_QUERY_SEGMENT_NAME] ?? request.header(API_KEY_QUERY_SEGMENT_NAME);
      const trueValue = this.reflector.get<TrueValue>(API_KEY_GUARD_TRUE_VALUE_TOKEN, context.getHandler());
      const result = apiKey === trueValue;
      logSegment.log(`Result`, {
        url: request.url,
        apiKey,
        result,
      });
      return result;
    });
  }
}
