import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { provideMockActions } from '@ngrx/effects/testing';
import { AuthorizationEffects } from './authorization.effects';
import * as AuthAPIActions from '../actions/api.actions';
import { Action } from '@ngrx/store';
import { Router } from '@angular/router';
import {
  AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN,
  AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_DEFAULT,
  AUTH_ROUTE_URL_FOR_CREATING_PROFILE_TOKEN,
  AUTH_ROUTE_URL_FOR_CREATING_PROFILE_DEFAULT,
  AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN,
  AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_DEFAULT,
} from '../../routeURLs';
import * as AuthUIActions from '../actions/ui.actions';
import { hot } from '@nrwl/angular/testing';
import { mockUsers, testUserId } from '@seed/shared/mock-data';
import { InjectionToken } from '@angular/core';
import { AUTH_IS_AUTHORIZED_HANDLER_TOKEN } from '../../isAuthorized';
import { UserService } from '../../userService/user.service';

describe(AuthorizationEffects.name, () => {
  // region SETUP
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

  function testRedirect(effectName: string, action: Action, token: InjectionToken<string>, defaultURL: string): void {
    function getEffect() {
      return (getEffects() as any)[effectName] as Observable<unknown>;
    }

    describe(effectName, () => {
      it(`navigates user to ${token.toString()} URL (default value)`, () => {
        actions$ = of(action);
        getEffect().subscribe();
        expect(navigateByUrlMock).toHaveBeenCalledWith(defaultURL);
      });

      it(`navigates user to ${token.toString()} URL (configured value)`, () => {
        const customURL = '/custom';
        TestBed.overrideProvider(token, { useValue: customURL });
        actions$ = of(action);
        getEffect().subscribe();
        expect(navigateByUrlMock).toHaveBeenCalledWith(customURL);
      });

      it(`logs error if navigation didn't happen`, () => {
        actions$ = of(action);
        navigateByUrlMock.mockReturnValue(of(false));
        spyOn(console, 'error');
        getEffect().subscribe();
        expect(navigateByUrlMock).toHaveBeenCalledWith(defaultURL);
        expect(console.error).toHaveBeenCalledWith(`${effectName} failed to navigate`);
      });

      it(`logs error if navigation failed`, () => {
        actions$ = of(action);
        const error = new Error('error');
        navigateByUrlMock.mockReturnValue(throwError(error));
        spyOn(console, 'error');
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
  );

  describe('profileCreate$', () => {
    it(`dispatches "${AuthAPIActions.profileCreateSuccess.type}" if userService.create() returns User`, () => {
      const action = AuthUIActions.profileCreate({ user: mockUsers[0] });
      const completion = AuthAPIActions.profileCreateSuccess({ user: mockUsers[0] });
      userCreateMock.mockReturnValue(of(mockUsers[0]));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(getEffects().profileCreate$).toBeObservable(expected);
      expect(userCreateMock).toHaveBeenCalledWith(mockUsers[0]);
    });

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if userService.create() throws an error`, () => {
      const action = AuthUIActions.profileCreate({ user: mockUsers[0] });
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      userCreateMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(getEffects().profileCreate$).toBeObservable(expected);
      expect(userCreateMock).toHaveBeenCalledWith(mockUsers[0]);
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

  testRedirect(
    'redirectToAuthorizedPage$',
    AuthAPIActions.authorized(),
    AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN,
    AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_DEFAULT,
  );

  testRedirect(
    'redirectToNotAuthorizedPage$',
    AuthAPIActions.notAuthorized({ reason: '' }),
    AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN,
    AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_DEFAULT,
  );
});
