import { InjectionToken } from '@angular/core';
import { User } from '@prisma/client';

export type IsAuthorizedHandler = (user: User) => Promise<boolean>;

export const AUTH_IS_AUTHORIZED_HANDLER_TOKEN = new InjectionToken<IsAuthorizedHandler>('AUTH_IS_AUTHORIZED_HANDLER');

export const AUTH_IS_AUTHORIZED_HANDLER_DEFAULT: IsAuthorizedHandler = async () => Promise.resolve(true);
