import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SignInContainerComponent } from './sign-in.container';
import { ChangeDetectionStrategy } from '@angular/core';
import { By } from '@angular/platform-browser';
import { SignInUIComponent } from '@seed/front/shared/auth/ui';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { AuthActions, AuthFeature } from '@seed/front/shared/auth/state';
import { Store } from '@ngrx/store';
import { first } from 'rxjs/operators';
import { AuthMethods } from '@seed/front/shared/types';
import { testEmail, testPassword } from '@seed/shared/mock-data';

describe(SignInContainerComponent.name, () => {
  let component: SignInUIComponent;
  let fixture: ComponentFixture<SignInContainerComponent>;
  let store: MockStore;
  const initialState: AuthFeature.AuthPartialState = { [AuthFeature.AUTH_FEATURE_KEY]: AuthFeature.initialState };

  async function updateState(update: Partial<AuthFeature.State>): Promise<void> {
    const state = await store
      .select((s: Store) => s)
      .pipe(first())
      .toPromise();
    store.setState({
      ...state,
      [AuthFeature.AUTH_FEATURE_KEY]: {
        ...state[AuthFeature.AUTH_FEATURE_KEY],
        ...update,
      },
    });
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SignInContainerComponent, SignInUIComponent],
      providers: [provideMockStore({ initialState })],
    })
      .overrideComponent(SignInContainerComponent, {
        set: { changeDetection: ChangeDetectionStrategy.Default }, // To make fixture.detectChanges() work
      })
      .compileComponents();
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
    fixture = TestBed.createComponent(SignInContainerComponent);
    component = fixture.debugElement.query(By.directive(SignInUIComponent)).componentInstance;
    fixture.detectChanges();
  });

  it('links state.auth.isAuthenticating with UI component', async () => {
    expect(component.isAuthenticating).toBe(false);
    await updateState({ isAuthenticating: true });
    fixture.detectChanges();
    expect(component.isAuthenticating).toBe(true);
  });

  it('links state.auth.errorMessage with UI component', async () => {
    const errorMessage = 'Wrong password';
    expect(component.errorMessage).toBe(undefined);
    await updateState({ errorMessage });
    fixture.detectChanges();
    expect(component.errorMessage).toBe(errorMessage);
  });

  it('links isAuthenticated with UI component', async () => {
    expect(component.isAuthenticated).toBe(false);
    await updateState({ userId: '123', isAuthenticating: false });
    fixture.detectChanges();
    expect(component.isAuthenticated).toBe(true);
  });

  it('dispatches action "authenticateAnonymously" when AuthMethods.anonymous is emitted from component with through signIn emitter', () => {
    component.signIn.next({ method: AuthMethods.anonymous });
    expect(store.dispatch).toHaveBeenCalledWith(AuthActions.authenticateAnonymously());
  });

  it('dispatches action "authenticateWithGoogle" when AuthMethods.google is emitted from component with through signIn emitter', () => {
    component.signIn.next({ method: AuthMethods.google });
    expect(store.dispatch).toHaveBeenCalledWith(AuthActions.authenticateWithGoogle());
  });

  it('dispatches action "authenticateWithGitHub" when AuthMethods.github is emitted from component with through signIn emitter', () => {
    component.signIn.next({ method: AuthMethods.github });
    expect(store.dispatch).toHaveBeenCalledWith(AuthActions.authenticateWithGitHub());
  });

  it('dispatches action "authenticateWithEmailAndPassword" when AuthMethods.password is emitted from component with through signIn emitter', () => {
    const email = testEmail;
    const password = testPassword;
    component.signIn.next({ method: AuthMethods.password, email, password });
    expect(store.dispatch).toHaveBeenCalledWith(AuthActions.authenticateWithEmailAndPassword({ email, password }));
  });

  it('dispatches action "authenticateWithEmailAndPassword" when AuthMethods.password is emitted from component with through signIn emitter, even with empty email & password', () => {
    const email = '';
    const password = '';
    component.signIn.next({ method: AuthMethods.password, email, password });
    expect(store.dispatch).toHaveBeenCalledWith(AuthActions.authenticateWithEmailAndPassword({ email, password }));
  });

  it('dispatches action "signUpWithEmailAndPassword" when component emit signUp emitter', () => {
    const email = testEmail;
    const password = testPassword;
    component.signUp.next({ email, password });
    expect(store.dispatch).toHaveBeenCalledWith(AuthActions.signUpWithEmailAndPassword({ email, password }));
  });

  it('dispatches action "signUpWithEmailAndPassword" when component emit signUp emitter, even with empty email & password', () => {
    const email = '';
    const password = '';
    component.signUp.next({ email, password });
    expect(store.dispatch).toHaveBeenCalledWith(AuthActions.signUpWithEmailAndPassword({ email, password }));
  });

  it('throws error when unknown AuthMethod is emitted from component with through signIn emitter', () => {
    const originalConsoleError = console.error;
    console.error = jest.fn();
    const method = AuthMethods.facebook;
    component.signIn.next({ method });
    expect(console.error).toHaveBeenCalledWith(`Auth method ${method} is not supported yet.`);
    console.error = originalConsoleError;
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('dispatches action "signOut" when event signOut emitted from component', () => {
    component.signOut.next();
    expect(store.dispatch).toHaveBeenCalledWith(AuthActions.signOut());
  });
});
