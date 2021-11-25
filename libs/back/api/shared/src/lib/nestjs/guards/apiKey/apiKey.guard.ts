import { CanActivate, CustomDecorator, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

export const API_KEY_QUERY_SEGMENT_NAME = 'API_KEY';
export const API_KEY_GUARD_TRUE_VALUE_TOKEN = 'API_KEY_GUARD_TRUE_VALUE_TOKEN';
type TrueValue = string;

export const ApiKeyGuardSetTrueValue = (value: TrueValue): CustomDecorator =>
  SetMetadata(API_KEY_GUARD_TRUE_VALUE_TOKEN, value);

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request: Request = context.switchToHttp().getRequest();
    const apiKey = request.query[API_KEY_QUERY_SEGMENT_NAME];
    const trueValue = this.reflector.get<TrueValue>(API_KEY_GUARD_TRUE_VALUE_TOKEN, context.getHandler());
    return apiKey === trueValue;
  }
}
