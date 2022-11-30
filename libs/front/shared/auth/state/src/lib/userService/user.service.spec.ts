import { TestBed } from '@angular/core/testing';
import { UserService } from './user.service';
import { provideMockStore } from '@ngrx/store/testing';
import { mockUsers, testJWT } from '@seed/shared/mock-data';
import { AUTH_FEATURE_KEY } from '../+state/auth.reducer';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { throwError } from 'rxjs';
import { hot } from 'jasmine-marbles';
import { ZERO } from '@seed/shared/constants';
import { User } from '@prisma/client';

describe(UserService.name, () => {
  // region SETUP
  let service: UserService;
  const jwt = testJWT;
  const getMock = jest.fn();
  const postMock = jest.fn();
  const user: User & { email: string } = { ...mockUsers[ZERO], email: 'test@test.com' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        UserService,
        provideMockStore({ initialState: { [AUTH_FEATURE_KEY]: { jwt } } }),
        {
          provide: HttpClient,
          useValue: {
            get: getMock,
            post: postMock,
          },
        },
      ],
    });
    service = TestBed.inject(UserService);
  });

  function getExpectedOptions() {
    return {
      headers: {
        authorization: `Bearer ${jwt}`,
      },
    };
  }

  // endregion

  describe(UserService.prototype.get.name, () => {
    it('executes GET /api/users/:id and returns User if 200', () => {
      const expected$ = hot('a', { a: user });
      getMock.mockReturnValue(hot('a', { a: user }));
      expect(service.get(user.id)).toBeObservable(expected$);
      expect(getMock).toHaveBeenCalledWith(`/api/users/${user.id}`, getExpectedOptions());
    });

    it('executes GET /api/users/:id and returns null if 404', () => {
      const response = new HttpErrorResponse({
        error: 'test 404 error',
        status: 404,
        statusText: 'Not Found',
      });
      const expected$ = hot('(a|)', { a: null });
      getMock.mockReturnValue(throwError(response));
      expect(service.get(user.id)).toBeObservable(expected$);
      expect(getMock).toHaveBeenCalledWith(`/api/users/${user.id}`, getExpectedOptions());
    });
  });

  describe(UserService.prototype.getMe.name, () => {
    it('executes GET /api/users/me and returns User if 200', () => {
      const expected$ = hot('a', { a: user });
      getMock.mockReturnValue(hot('a', { a: user }));
      expect(service.getMe()).toBeObservable(expected$);
      expect(getMock).toHaveBeenCalledWith(`/api/users/me`, getExpectedOptions());
    });

    it('executes GET /api/users/me and returns null if 404', () => {
      const response = new HttpErrorResponse({
        error: 'test 404 error',
        status: 404,
        statusText: 'Not Found',
      });
      const expected$ = hot('(a|)', { a: null });
      getMock.mockReturnValue(throwError(response));
      expect(service.getMe()).toBeObservable(expected$);
      expect(getMock).toHaveBeenCalledWith(`/api/users/me`, getExpectedOptions());
    });
  });

  describe(UserService.prototype.create.name, () => {
    it('executes POST /api/users', () => {
      const expected$ = hot('a', { a: user });
      postMock.mockReturnValue(hot('a', { a: user }));
      const mockDate = new Date();
      jest.useFakeTimers({
        now: mockDate,
      });
      expect(service.create(user)).toBeObservable(expected$);
      expect(postMock).toHaveBeenCalledWith(
        `/api/users`,
        { ...user, userName: mockDate.getTime().toString() },
        getExpectedOptions(),
      );
    });
  });
});
