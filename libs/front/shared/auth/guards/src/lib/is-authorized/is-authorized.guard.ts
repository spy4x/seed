import { Inject, Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';
import { Store } from '@ngrx/store';
import { map, take } from 'rxjs/operators';
import { AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN, AuthSelectors } from '@seed/front/shared/auth/state';
import { ONE } from '@seed/shared/constants';

@Injectable({ providedIn: 'root' })
export class IsAuthorizedGuard implements CanActivate {
  urlTree = this.router.parseUrl(this.authenticationURL);

  constructor(
    readonly store: Store,
    readonly router: Router,
    @Inject(AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN) readonly authenticationURL: string,
  ) {}

  canActivate(): Observable<boolean | UrlTree> {
    return this.store.select(AuthSelectors.getIsAuthorized).pipe(
      take(ONE),
      map(isAuthorized => {
        return isAuthorized ? true : this.urlTree;
      }),
    );
  }
}
