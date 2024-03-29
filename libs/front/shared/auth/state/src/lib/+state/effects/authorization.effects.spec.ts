import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { provideMockActions } from '@ngrx/effects/testing';
import { AuthorizationEffects } from './authorization.effects';
import * as AuthAPIActions from '../actions/api.actions';
import { Action } from '@ngrx/store';
import { Router } from '@angular/router';
import {
  AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_DEFAULT,
  AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN,
  AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_DEFAULT,
  AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN,
  AUTH_ROUTE_URL_FOR_CREATING_PROFILE_DEFAULT,
  AUTH_ROUTE_URL_FOR_CREATING_PROFILE_TOKEN,
} from '../../routeURLs';
import * as AuthUIActions from '../actions/ui.actions';
import { mockUsers, testUserId } from '@seed/shared/mock-data';
import { InjectionToken } from '@angular/core';
import { AUTH_IS_AUTHORIZED_HANDLER_TOKEN } from '../../isAuthorized';
import { UserService } from '../../userService/user.service';
import * as AuthSelectors from '../auth.selectors';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { hot } from 'jasmine-marbles';

describe(AuthorizationEffects.name, () => {
  // region SETUP
  let store: MockStore;
  let actions$ = new Observable<Action>();
  const navigateByUrlMock = jest.fn();
  const userCreateMock = jest.fn();
  const userGetMock = jest.fn();
  const userGetMeMock = jest.fn();
  const isAuthorizedHandlerMock = jest.fn();

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AuthorizationEffects,
        provideMockActions(() => actions$),
        provideMockStore(),
        {
          provide: Router,
          useValue: {
            navigateByUrl: navigateByUrlMock,
          },
        },
        {
          provide: UserService,
          useValue: {
            get: userGetMock,
            getMe: userGetMeMock,
            create: userCreateMock,
          },
        },
        {
          provide: AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN,
          useValue: AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_DEFAULT,
        },
        {
          provide: AUTH_ROUTE_URL_FOR_CREATING_PROFILE_TOKEN,
          useValue: AUTH_ROUTE_URL_FOR_CREATING_PROFILE_DEFAULT,
        },
        {
          provide: AUTH_IS_AUTHORIZED_HANDLER_TOKEN,
          useValue: isAuthorizedHandlerMock,
        },
        {
          provide: AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN,
          useValue: AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_DEFAULT,
        },
      ],
    });
    navigateByUrlMock.mockReset();
    userCreateMock.mockReset();
    userGetMock.mockReset();
    userGetMeMock.mockReset();
    isAuthorizedHandlerMock.mockReset();
  });

  function getEffects(): AuthorizationEffects {
    return TestBed.inject(AuthorizationEffects);
  }

  function testRedirect(
    effectName: string,
    action: Action,
    token: InjectionToken<string>,
    defaultURL: string,
    rewriteStoreSelectors?: [unknown, unknown][],
  ): void {
    function getEffect() {
      return (getEffects() as any)[effectName] as Observable<unknown>;
    }

    function rewriteSelectors() {
      if (!rewriteStoreSelectors) {
        return;
      }
      store = TestBed.inject(MockStore);
      for (const selector of rewriteStoreSelectors) {
        store.overrideSelector(selector[0] as string, selector[1]);
      }
    }

    describe(effectName, () => {
      it(`navigates user to ${token.toString()} URL (default value)`, () => {
        rewriteSelectors();
        actions$ = of(action);
        getEffect().subscribe();
        expect(navigateByUrlMock).toHaveBeenCalledWith(defaultURL);
      });

      it(`navigates user to ${token.toString()} URL (configured value)`, () => {
        const customURL = '/custom';
        TestBed.overrideProvider(token, { useValue: customURL });
        rewriteSelectors();
        actions$ = of(action);
        getEffect().subscribe();
        expect(navigateByUrlMock).toHaveBeenCalledWith(customURL);
      });

      it(`logs error if navigation didn't happen`, () => {
        rewriteSelectors();
        actions$ = of(action);
        navigateByUrlMock.mockReturnValue(of(false));
        jest.spyOn(console, 'error');
        getEffect().subscribe();
        expect(navigateByUrlMock).toHaveBeenCalledWith(defaultURL);
        expect(console.error).toHaveBeenCalledWith(`${effectName} failed to navigate to "${defaultURL}"`);
      });

      it(`logs error if navigation failed`, () => {
        rewriteSelectors();
        actions$ = of(action);
        const error = new Error('error');
        navigateByUrlMock.mockReturnValue(throwError(error));
        jest.spyOn(console, 'error');
        getEffect().subscribe();
        expect(navigateByUrlMock).toHaveBeenCalledWith(defaultURL);
        expect(console.error).toHaveBeenCalledWith(effectName, error);
      });
    });
  }

  // endregion

  describe('profileLoad$', () => {
    const signedInUser = { userId: testUserId } as any;

    function runTest(actionCreator: typeof AuthAPIActions.signedIn | typeof AuthAPIActions.initSignedIn) {
      describe(`on ${actionCreator.type}`, () => {
        it(`dispatches "${AuthAPIActions.profileLoadSuccess.type}" if userService.getMe() returns User`, () => {
          const action = actionCreator(signedInUser);
          const completion = AuthAPIActions.profileLoadSuccess({ user: mockUsers[0] });
          userGetMeMock.mockReturnValue(of(mockUsers[0]));
          actions$ = hot('a', { a: action });
          const expected = hot('b', { b: completion });
          expect(getEffects().profileLoad$).toBeObservable(expected);
          expect(userGetMeMock).toHaveBeenCalledWith();
        });

        it(`dispatches "${AuthAPIActions.profileLoadSuccessNoProfileYet.type}" if userService.getMe() returns null`, () => {
          const action = actionCreator(signedInUser);
          const completion = AuthAPIActions.profileLoadSuccessNoProfileYet();
          userGetMeMock.mockReturnValue(of(null));
          actions$ = hot('a', { a: action });
          const expected = hot('b', { b: completion });
          expect(getEffects().profileLoad$).toBeObservable(expected);
          expect(userGetMeMock).toHaveBeenCalledWith();
        });

        it(`dispatches "${AuthAPIActions.actionFailed.type}" if userService.getMe() throws an error`, () => {
          const action = actionCreator(signedInUser);
          const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
          userGetMeMock.mockReturnValue(throwError(new Error('Auth failed')));
          actions$ = hot('a', { a: action });
          const expected = hot('b', { b: completion });
          expect(getEffects().profileLoad$).toBeObservable(expected);
          expect(userGetMeMock).toHaveBeenCalledWith();
        });
      });
    }

    runTest(AuthAPIActions.signedIn);
    runTest(AuthAPIActions.initSignedIn);
  });

  testRedirect(
    'redirectToCreateProfile$',
    AuthAPIActions.signedUp({} as any),
    AUTH_ROUTE_URL_FOR_CREATING_PROFILE_TOKEN,
    AUTH_ROUTE_URL_FOR_CREATING_PROFILE_DEFAULT,
    [[AuthSelectors.getOriginalUrl, '/original']],
  );

  describe('profileCreate$', () => {
    const user = { email: 'test@test.com', ...mockUsers[0] };
    it(`dispatches "${AuthAPIActions.profileCreateSuccess.type}" if userService.create() returns User`, () => {
      const action = AuthUIActions.profileCreate({ user });
      const completion = AuthAPIActions.profileCreateSuccess({ user });
      userCreateMock.mockReturnValue(of(user));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(getEffects().profileCreate$).toBeObservable(expected);
      expect(userCreateMock).toHaveBeenCalledWith(user);
    });

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if userService.create() throws an error`, () => {
      const action = AuthUIActions.profileCreate({ user });
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      userCreateMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(getEffects().profileCreate$).toBeObservable(expected);
      expect(userCreateMock).toHaveBeenCalledWith(user);
    });
  });

  testRedirect(
    'redirectToCreateProfile$',
    AuthAPIActions.profileLoadSuccessNoProfileYet(),
    AUTH_ROUTE_URL_FOR_CREATING_PROFILE_TOKEN,
    AUTH_ROUTE_URL_FOR_CREATING_PROFILE_DEFAULT,
  );

  describe('authorize$', () => {
    const [user] = mockUsers;

    function runTest(
      actionCreator: typeof AuthAPIActions.profileCreateSuccess | typeof AuthAPIActions.profileLoadSuccess,
    ) {
      describe(`on ${actionCreator.type}`, () => {
        it(`dispatches "${AuthAPIActions.authorized.type}" if isAuthorizedHandler() returns true`, () => {
          const action = actionCreator({ user });
          const completion = AuthAPIActions.authorized();
          isAuthorizedHandlerMock.mockReturnValue(of(true));
          actions$ = hot('a', { a: action });
          const expected = hot('b', { b: completion });
          expect(getEffects().authorize$).toBeObservable(expected);
          expect(isAuthorizedHandlerMock).toHaveBeenCalledWith(user);
        });

        it(`dispatches "${AuthAPIActions.notAuthorized.type}" if isAuthorizedHandler() returns string`, () => {
          const reason = 'You are banned';
          const action = actionCreator({ user });
          const completion = AuthAPIActions.notAuthorized({ reason });
          isAuthorizedHandlerMock.mockReturnValue(of(reason));
          actions$ = hot('a', { a: action });
          const expected = hot('b', { b: completion });
          expect(getEffects().authorize$).toBeObservable(expected);
          expect(isAuthorizedHandlerMock).toHaveBeenCalledWith(user);
        });

        it(`dispatches "${AuthAPIActions.actionFailed.type}" if isAuthorizedHandler() throws an error`, () => {
          const action = actionCreator({ user });
          const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
          isAuthorizedHandlerMock.mockReturnValue(throwError(new Error('Auth failed')));
          actions$ = hot('a', { a: action });
          const expected = hot('b', { b: completion });
          expect(getEffects().authorize$).toBeObservable(expected);
          expect(isAuthorizedHandlerMock).toHaveBeenCalledWith(user);
        });
      });
    }

    runTest(AuthAPIActions.profileCreateSuccess);
    runTest(AuthAPIActions.profileLoadSuccess);
  });

  describe('redirectToAuthorizedPage$', () => {
    describe(`with originalURL equals "/"`, () => {
      testRedirect(
        'redirectToAuthorizedPage$',
        AuthAPIActions.authorized(),
        AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN,
        AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_DEFAULT,
        [[AuthSelectors.getOriginalUrl, '/']],
      );
    });
    describe(`with originalURL starts with ${AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN.toString()} value`, () => {
      testRedirect(
        'redirectToAuthorizedPage$',
        AuthAPIActions.authorized(),
        AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN,
        AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_DEFAULT,
        [[AuthSelectors.getOriginalUrl, AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_DEFAULT]],
      );
    });
    describe(`with custom originalURL`, () => {
      it(`redirects to originalURL`, () => {
        const originalURL = '/my-url';
        store = TestBed.inject(MockStore);
        store.overrideSelector(AuthSelectors.getOriginalUrl, originalURL);
        actions$ = of(AuthAPIActions.authorized);
        getEffects().redirectToAuthorizedPage$.subscribe();
        expect(navigateByUrlMock).toHaveBeenCalledWith(originalURL);
      });
    });
  });

  testRedirect(
    'redirectToNotAuthorizedPage$',
    AuthAPIActions.notAuthorized({ reason: '' }),
    AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN,
    AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_DEFAULT,
  );

  testRedirect(
    'redirectToNotAuthorizedPage$',
    AuthAPIActions.signedOut(),
    AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN,
    AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_DEFAULT,
  );
});
