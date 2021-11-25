import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpStatusCode } from '@angular/common/http';
import type { Prisma, User } from '@prisma/client';
import { Observable, of, throwError } from 'rxjs';
import { Store } from '@ngrx/store';
import { AuthSelectors } from '../../index';
import { catchError, take } from 'rxjs/operators';
import { ONE } from '@seed/shared/constants';

@Injectable()
export class UserService {
  readonly baseUrl = `/api/users`;

  constructor(readonly http: HttpClient, readonly store: Store) {}

  get(id: string): Observable<null | User> {
    return this.convert404ToNull(
      this.http.get<null | User>(`${this.baseUrl}/${id}`, { headers: { ...this.getAuthHeader() } }),
    );
  }

  getMe(): Observable<null | User> {
    return this.convert404ToNull(
      this.http.get<null | User>(`${this.baseUrl}/me`, { headers: { ...this.getAuthHeader() } }),
    );
  }

  create(input: Prisma.UserCreateInput): Observable<User> {
    return this.http.post<User>(this.baseUrl, input, { headers: { ...this.getAuthHeader() } });
  }

  private getAuthHeader(): { authorization?: string } {
    let jwt: undefined | string = undefined;
    this.store
      .select(AuthSelectors.getJWT)
      .pipe(take(ONE))
      .subscribe(j => (jwt = j));
    return {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition,@typescript-eslint/restrict-template-expressions
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
    };
  }

  private convert404ToNull<T>(obs: Observable<T>): Observable<null | T> {
    return obs.pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === HttpStatusCode.NotFound) {
          return of(null);
        }
        return throwError(error);
      }),
    );
  }
}
