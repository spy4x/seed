import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { API_CONFIG } from '../../constants/config.constant';

export const API_KEY_QUERY_SEGMENT_NAME = 'API_KEY';
export const ApiKeyGuardTrueValuePath = 'ApiKeyGuardTrueValuePath';
type ConfigPath = string[];
export const ApiKeyGuardConfigPath = (path: ConfigPath) => SetMetadata(ApiKeyGuardTrueValuePath, path);

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const logPrefix = 'ApiKeyGuard.canActivate()';
    const request: Request = context.switchToHttp().getRequest();
    const apiKey = request.query[API_KEY_QUERY_SEGMENT_NAME];
    const path = this.reflector.get<ConfigPath>(ApiKeyGuardTrueValuePath, context.getHandler());
    console.log(logPrefix, ApiKeyGuardTrueValuePath, { path });
    const apiKeyTrueValue: string = path.reduce((acc, cur) => acc[cur], API_CONFIG as any);
    const apiKeyMatchesTrueValue = apiKey === apiKeyTrueValue;
    console.log(logPrefix, { apiKeyMatchesTrueValue, apiKey, apiKeyTrueValue });
    return apiKeyMatchesTrueValue;
  }
}
