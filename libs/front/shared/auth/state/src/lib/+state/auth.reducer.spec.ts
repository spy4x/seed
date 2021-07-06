import * as AuthActions from './auth.actions';
import { initialState, reducer } from './auth.reducer';

describe('Auth Reducer', () => {
  it('should return the previous state in case of unknown action', () => {
    expect(reducer(initialState, {} as any)).toBe(initialState);
  });

  it('authenticated', () => {
    const result = reducer(initialState, AuthActions.authenticated({ userId: '123' }));
    expect(result.isAuthenticating).toBe(false);
    expect(result.userId).toBe('123');
  });

  it('notAuthenticated', () => {
    const result = reducer(initialState, AuthActions.notAuthenticated());
    expect(result.isAuthenticating).toBe(false);
    expect(result.userId).toBe(undefined);
  });

  it('authenticateAnonymously', () => {
    const result = reducer({ ...initialState, isAuthenticating: false }, AuthActions.authenticateAnonymously());
    expect(result.isAuthenticating).toBe(true);
  });

  it('signOut', () => {
    const state = { ...initialState, isAuthenticating: false, userId: '123' };
    expect(reducer(state, AuthActions.signOut())).toBe(state);
  });
});
