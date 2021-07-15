import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SignInContainerComponent } from './sign-in.container';
import { ChangeDetectionStrategy } from '@angular/core';
import { By } from '@angular/platform-browser';
import { SharedAuthUIModule, SignInUIComponent } from '@seed/front/shared/auth/ui';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { AuthFeature, AuthUIActions } from '@seed/front/shared/auth/state';
import { Store } from '@ngrx/store';
import { first } from 'rxjs/operators';
import { AuthProvider, AuthStage } from '@seed/front/shared/types';
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
      imports: [SharedAuthUIModule],
      declarations: [SignInContainerComponent],
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

  it('links state.auth.stage with UI component', async () => {
    expect(component.stage).toBe(AuthStage.initialization);
    await updateState({ stage: AuthStage.signingOut });
    fixture.detectChanges();
    expect(component.stage).toBe(AuthStage.signingOut);
  });

  it('links state.auth.email with UI component', async () => {
    expect(component.email).toBe(undefined);
    await updateState({ email: testEmail });
    fixture.detectChanges();
    expect(component.email).toBe(testEmail);
  });

  it('links state.auth.inProgress with UI component', async () => {
    expect(component.inProgress).toBe(false);
    await updateState({ inProgress: true });
    fixture.detectChanges();
    expect(component.inProgress).toBe(true);
  });

  it('links state.auth.errorMessage with UI component', async () => {
    const errorMessage = 'Wrong password';
    expect(component.errorMessage).toBe(undefined);
    await updateState({ error: { message: errorMessage, code: '123' } });
    fixture.detectChanges();
    expect(component.errorMessage).toBe(errorMessage);
  });

  it('links state.auth.successMessage with UI component', async () => {
    const successMessage = 'Password reset!';
    expect(component.successMessage).toBe(undefined);
    await updateState({ successMessage });
    fixture.detectChanges();
    expect(component.successMessage).toBe(successMessage);
  });

  it('links state.auth.providers with UI component', async () => {
    const providers = [AuthProvider.link, AuthProvider.github];
    expect(component.providers).toEqual([]);
    await updateState({ providers });
    fixture.detectChanges();
    expect(component.providers).toEqual(providers);
  });

  it('links state.auth.providers with UI component', async () => {
    const provider = AuthProvider.link;
    expect(component.selectedProvider).toBe(undefined);
    await updateState({ selectedProvider: provider });
    fixture.detectChanges();
    expect(component.selectedProvider).toBe(provider);
  });

  it(`dispatches action "${AuthUIActions.chooseProvider.type}" when component emits "selectProvider"`, () => {
    const provider = AuthProvider.password;
    component.selectProvider.next({ method: provider });
    expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.chooseProvider({ provider }));
  });

  it(`dispatches action "${AuthUIActions.enterEmail.type}" when component emits "enterEmail"`, () => {
    component.enterEmail.next({ email: testEmail });
    expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.enterEmail({ email: testEmail }));
  });

  it(`dispatches action "${AuthUIActions.chooseProvider.type}" when component emits "deselectProvider"`, () => {
    component.deselectProvider.next();
    expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.chooseProvider({ provider: undefined }));
  });

  it(`dispatches action "${AuthUIActions.changeUser.type}" when component emits "changeUser"`, () => {
    component.changeUser.next();
    expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.changeUser());
  });

  it(`dispatches action "${AuthUIActions.signUpAnonymously.type}" when component emits "signIn" event with ${AuthProvider.anonymous} provider`, () => {
    component.signIn.next({ method: AuthProvider.anonymous });
    expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.signUpAnonymously());
  });

  it(`dispatches action "${AuthUIActions.authenticateWithGoogle.type}" when component emits "signIn" event with ${AuthProvider.google} provider`, () => {
    component.signIn.next({ method: AuthProvider.google });
    expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.authenticateWithGoogle());
  });

  it(`dispatches action "${AuthUIActions.authenticateWithGitHub.type}" when component emits "signIn" event with ${AuthProvider.github} provider`, () => {
    component.signIn.next({ method: AuthProvider.github });
    expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.authenticateWithGitHub());
  });

  it(`dispatches action "${AuthUIActions.signInWithEmailAndPassword.type}" when component emits "signIn" event with ${AuthProvider.password} provider`, () => {
    const password = testPassword;
    component.signIn.next({ method: AuthProvider.password, password });
    expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.signInWithEmailAndPassword({ password }));
  });

  it(`dispatches action "${AuthUIActions.authenticateWithEmailLink.type}" when component emits "signIn" event with ${AuthProvider.link} provider`, () => {
    component.signIn.next({ method: AuthProvider.link });
    expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.authenticateWithEmailLink());
  });

  it(`dispatches action "${AuthUIActions.signUpWithEmailAndPassword.type}" when component emits "signUp" event with ${AuthProvider.password} provider`, () => {
    const provider = AuthProvider.password;
    const password = testPassword;
    component.signUp.next({ method: provider, password });
    expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.signUpWithEmailAndPassword({ password }));
  });

  it(`dispatches action "${AuthUIActions.restorePassword.type}" when component emits "restorePassword" event`, () => {
    component.restorePassword.next();
    expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.restorePassword());
  });

  it('throws error when unknown AuthMethod is emitted from component with through signIn emitter', () => {
    const originalConsoleError = console.error;
    console.error = jest.fn();
    const method = 'test';
    component.signIn.next({ method: method as any });
    expect(console.error).toHaveBeenCalledWith(`Auth method ${method} is not supported yet.`);
    console.error = originalConsoleError;
    expect(store.dispatch).not.toHaveBeenCalled();
  });
});
