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
    expect(component.isAuthenticating).toBe(true);
    await updateState({ isAuthenticating: false });
    fixture.detectChanges();
    expect(component.isAuthenticating).toBe(false);
  });

  it('links isAuthenticated with UI component', async () => {
    expect(component.isAuthenticated).toBe(false);
    await updateState({ userId: '123', isAuthenticating: false });
    fixture.detectChanges();
    expect(component.isAuthenticated).toBe(true);
  });

  it('dispatches action "authenticateAnonymously" when AuthMethods.anonymous is emitted from component with through signIn emitter', () => {
    component.signIn.next(AuthMethods.anonymous);
    expect(store.dispatch).toHaveBeenCalledWith(AuthActions.authenticateAnonymously());
  });

  it('throws error when unknown AuthMethod is emitted from component with through signIn emitter', () => {
    const originalConsoleError = console.error;
    console.error = jest.fn();
    const method = AuthMethods.github;
    component.signIn.next(method);
    expect(console.error).toHaveBeenCalledWith(`Auth method ${method} is not supported yet.`);
    console.error = originalConsoleError;
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('dispatches action "signOut" when event signOut emitted from component', () => {
    component.signOut.next();
    expect(store.dispatch).toHaveBeenCalledWith(AuthActions.signOut());
  });
});
