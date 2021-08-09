import { TestBed } from '@angular/core/testing';
import { hot } from '@nrwl/angular/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Router } from '@angular/router';
import { AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN, AuthSelectors } from '@seed/front/shared/auth/state';
import { IsNotAuthorizedGuard } from './is-not-authorized.guard';

describe(IsNotAuthorizedGuard.name, () => {
  // region SETUP
  let guard: IsNotAuthorizedGuard;
  let store: MockStore;
  const redirectUrl = '/home';
  const parseUrlMock = jest.fn().mockReturnValue(redirectUrl);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        {
          provide: Router,
          useValue: {
            parseUrl: parseUrlMock,
          },
        },
        {
          provide: AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN,
          useValue: redirectUrl,
        },
      ],
    });
    guard = TestBed.inject(IsNotAuthorizedGuard);
    // console.log(guard.urlTree);
    store = TestBed.inject(MockStore);
    expect(parseUrlMock).toHaveBeenCalledWith(redirectUrl);
  });
  // endregion

  it('if user is not authorized - returns$ TRUE and ends ', () => {
    store.overrideSelector(AuthSelectors.getIsAuthorized, false);
    expect(guard.canActivate()).toBeObservable(hot('(a|)', { a: true }));
  });

  it('if user is authorized - returns$ UrlTree (with redirect to authorized page) and ends', () => {
    store.overrideSelector(AuthSelectors.getIsAuthorized, true);
    expect(guard.canActivate()).toBeObservable(hot('(a|)', { a: redirectUrl }));
  });
});
