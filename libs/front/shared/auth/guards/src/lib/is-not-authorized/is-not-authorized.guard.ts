import { Inject, Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';
import { map, take } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN, AuthSelectors } from '@seed/front/shared/auth/state';
import { ONE } from '@seed/shared/constants';

@Injectable({ providedIn: 'root' })
export class IsNotAuthorizedGuard implements CanActivate {
  urlTree = this.router.parseUrl(this.authorizedURL);

  constructor(
    readonly store: Store,
    readonly router: Router,
    @Inject(AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN) readonly authorizedURL: string,
  ) {}

  canActivate(): Observable<boolean | UrlTree> {
    return this.store.select(AuthSelectors.getIsAuthorized).pipe(
      take(ONE),
      map(isAuthorized => {
        return isAuthorized ? this.urlTree : true;
      }),
    );
  }
}
