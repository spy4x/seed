import { TestBed } from '@angular/core/testing';
import { Observable, of, ReplaySubject } from 'rxjs';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { AuthEffects } from './auth.effects';
import * as AuthActions from './auth.actions';
import { AngularFireAuth } from '@angular/fire/auth';
import { hot } from '@nrwl/angular/testing';

describe(AuthEffects.name, () => {
  let actions$: Observable<any>;
  let effects: AuthEffects;
  let user$: ReplaySubject<null | { uid: string }>;
  const signInAnonymouslyMock = jest.fn();
  const signOutMock = jest.fn();

  beforeEach(() => {
    user$ = new ReplaySubject<null | { uid: string }>();
    TestBed.configureTestingModule({
      providers: [
        AuthEffects,
        provideMockActions(() => actions$),
        provideMockStore(),
        {
          provide: AngularFireAuth,
          useValue: {
            user: user$,
            signInAnonymously: signInAnonymouslyMock,
            signOut: signOutMock,
          },
        },
      ],
    });
    effects = TestBed.inject(AuthEffects);
  });

  it('authenticatedStateSub$', () => {
    user$.next(null);
    user$.next({ uid: '123' });
    user$.next(null);
    const expected = hot('(abc)', {
      a: AuthActions.notAuthenticated(),
      b: AuthActions.authenticated({ userId: '123' }),
      c: AuthActions.notAuthenticated(),
    });
    expect(effects.authenticatedStateSub$).toBeObservable(expected);
  });

  it('authenticateAnonymously$', () => {
    actions$ = of(AuthActions.authenticateAnonymously());
    effects.authenticateAnonymously$.subscribe();
    expect(signInAnonymouslyMock).toHaveBeenCalled();
  });

  it('signOut$', () => {
    actions$ = of(AuthActions.signOut());
    effects.signOut$.subscribe();
    expect(signOutMock).toHaveBeenCalled();
  });
});
