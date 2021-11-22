import { TestBed } from '@angular/core/testing';
import { hot } from '@nrwl/angular/testing';
import { IsAuthorizedGuard } from './is-authorized.guard';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Router } from '@angular/router';
import { AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN, AuthSelectors } from '@seed/front/shared/auth/state';

describe(IsAuthorizedGuard.name, () => {
  // region SETUP
  let guard: IsAuthorizedGuard;
  let store: MockStore;
  const redirectUrl = '/auth';
  const parseUrlMock = jest.fn().mockReturnValue(redirectUrl);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        IsAuthorizedGuard,
        provideMockStore(),
        {
          provide: Router,
          useValue: {
            parseUrl: parseUrlMock,
          },
        },
        {
          provide: AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN,
          useValue: redirectUrl,
        },
      ],
    });
    guard = TestBed.inject(IsAuthorizedGuard);
    store = TestBed.inject(MockStore);
    expect(parseUrlMock).toHaveBeenCalledWith(redirectUrl);
  });
  // endregion

  it('if user is authorized - returns$ TRUE and ends ', () => {
    store.overrideSelector(AuthSelectors.getIsAuthorized, true);
    expect(guard.canActivate()).toBeObservable(hot('(a|)', { a: true }));
  });

  it('if user is not authorized - returns$ UrlTree (with redirect to auth page) and ends', () => {
    store.overrideSelector(AuthSelectors.getIsAuthorized, false);
    expect(guard.canActivate()).toBeObservable(hot('(a|)', { a: redirectUrl }));
  });
});
