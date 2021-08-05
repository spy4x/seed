import { InjectionToken } from '@angular/core';
import { User } from '@prisma/client';

/**
 * @returns TRUE if user is authorized, STRING (reason) if user is not authorized.
 */
export type IsAuthorizedHandler = (user: User) => Promise<true | string>;

export const AUTH_IS_AUTHORIZED_HANDLER_TOKEN = new InjectionToken<IsAuthorizedHandler>('AUTH_IS_AUTHORIZED_HANDLER');

export const AUTH_IS_AUTHORIZED_HANDLER_DEFAULT: IsAuthorizedHandler = async () => Promise.resolve(true);
