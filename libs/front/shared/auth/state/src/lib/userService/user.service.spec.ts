import { TestBed } from '@angular/core/testing';
import { UserService } from './user.service';
import { provideMockStore } from '@ngrx/store/testing';
import { mockUsers, testJWT } from '@seed/shared/mock-data';
import { AUTH_FEATURE_KEY } from '../+state/auth.reducer';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { hot } from '@nrwl/angular/testing';
import { throwError } from 'rxjs';

describe(UserService.name, () => {
  // region SETUP
  let service: UserService;
  const jwt = testJWT;
  const getMock = jest.fn();
  const postMock = jest.fn();
  const [user] = mockUsers;

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

  describe('get(id: string)', () => {
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

  describe('getMe()', () => {
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

  describe('create(input)', () => {
    it('executes POST /api/users', () => {
      const expected$ = hot('a', { a: user });
      postMock.mockReturnValue(hot('a', { a: user }));
      expect(service.create(user)).toBeObservable(expected$);
      expect(postMock).toHaveBeenCalledWith(`/api/users`, user, getExpectedOptions());
    });
  });
});
