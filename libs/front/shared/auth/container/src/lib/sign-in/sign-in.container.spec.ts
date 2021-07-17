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
import { testDisplayName, testEmail, testPassword, testPhotoURL, testUserId } from '@seed/shared/mock-data';

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

  describe('links properties to UI component', () => {
    it('state.auth.stage', async () => {
      expect(component.stage).toBe(AuthStage.initialization);
      await updateState({ stage: AuthStage.signingOut });
      fixture.detectChanges();
      expect(component.stage).toBe(AuthStage.signingOut);
    });

    it('state.auth.email', async () => {
      expect(component.email).toBe(undefined);
      await updateState({ email: testEmail });
      fixture.detectChanges();
      expect(component.email).toBe(testEmail);
    });

    it('state.auth.displayName', async () => {
      expect(component.displayName).toBe(undefined);
      await updateState({ displayName: testDisplayName });
      fixture.detectChanges();
      expect(component.displayName).toBe(testDisplayName);
    });

    it('state.auth.photoURL', async () => {
      expect(component.photoURL).toBe(undefined);
      await updateState({ photoURL: testPhotoURL });
      fixture.detectChanges();
      expect(component.photoURL).toBe(testPhotoURL);
    });

    it('state.auth.userId', async () => {
      expect(component.userId).toBe(undefined);
      await updateState({ userId: testUserId });
      fixture.detectChanges();
      expect(component.userId).toBe(testUserId);
    });

    it('state.auth.inProgress', async () => {
      expect(component.inProgress).toBe(false);
      await updateState({ inProgress: true });
      fixture.detectChanges();
      expect(component.inProgress).toBe(true);
    });

    it('state.auth.didUserSignUpEver', async () => {
      expect(component.isNewUser).toBe(false);
      await updateState({ providers: [AuthProvider.password] });
      fixture.detectChanges();
      expect(component.isNewUser).toBe(true);
      await updateState({ providers: [] });
      fixture.detectChanges();
      expect(component.isNewUser).toBe(false);
    });

    it('state.auth.errorMessage', async () => {
      const errorMessage = 'Wrong password';
      expect(component.errorMessage).toBe(undefined);
      await updateState({ error: { message: errorMessage, code: testUserId } });
      fixture.detectChanges();
      expect(component.errorMessage).toBe(errorMessage);
    });

    it('state.auth.successMessage', async () => {
      const successMessage = 'Password reset!';
      expect(component.successMessage).toBe(undefined);
      await updateState({ successMessage });
      fixture.detectChanges();
      expect(component.successMessage).toBe(successMessage);
    });

    it('state.auth.providers', async () => {
      const providers = [AuthProvider.link, AuthProvider.github];
      expect(component.providers).toEqual([]);
      await updateState({ providers });
      fixture.detectChanges();
      expect(component.providers).toEqual(providers);
    });

    it('state.auth.providers', async () => {
      const provider = AuthProvider.link;
      expect(component.selectedProvider).toBe(undefined);
      await updateState({ selectedProvider: provider });
      fixture.detectChanges();
      expect(component.selectedProvider).toBe(provider);
    });
  });

  describe('dispatches action when an event fire from UI component', function () {
    it(`"enterEmail" -> "${AuthUIActions.enterEmail.type}"`, () => {
      component.enterEmail.next({ email: testEmail });
      expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.enterEmail({ email: testEmail }));
    });

    it(`"selectProvider" -> "${AuthUIActions.selectProvider.type}"`, () => {
      const provider = AuthProvider.password;
      component.selectProvider.next({ provider: provider });
      expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.selectProvider({ provider }));
    });

    it(`"deselectProvider" -> "${AuthUIActions.deselectProvider.type}"`, () => {
      component.deselectProvider.next();
      expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.deselectProvider());
    });

    it(`"changeUser" -> "${AuthUIActions.changeUser.type}"`, () => {
      component.changeUser.next();
      expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.changeUser());
    });

    it(`"signOut" -> "${AuthUIActions.signOut.type}"`, () => {
      component.signOut.next();
      expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.signOut());
    });

    it(`"restorePassword" -> "${AuthUIActions.restorePassword.type}"`, () => {
      component.restorePassword.next();
      expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.restorePassword());
    });

    describe(`"sign(provider)" => "sign***"`, () => {
      it(`"${AuthProvider.anonymous}" -> "${AuthUIActions.signAnonymously.type}"`, () => {
        component.sign.next({ provider: AuthProvider.anonymous });
        expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.signAnonymously());
      });

      it(`"${AuthProvider.google}" -> "${AuthUIActions.signGoogle.type}"`, () => {
        component.sign.next({ provider: AuthProvider.google });
        expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.signGoogle());
      });

      it(`"${AuthProvider.github}" -> "${AuthUIActions.signGitHub.type}" `, () => {
        component.sign.next({ provider: AuthProvider.github });
        expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.signGitHub());
      });

      it(`"${AuthProvider.password}" -> "${AuthUIActions.signEmailPassword.type}"`, () => {
        const password = testPassword;
        component.sign.next({ provider: AuthProvider.password, password });
        expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.signEmailPassword({ password }));
      });

      it(`"${AuthProvider.link}" -> "${AuthUIActions.signEmailLink.type}"`, () => {
        component.sign.next({ provider: AuthProvider.link });
        expect(store.dispatch).toHaveBeenCalledWith(AuthUIActions.signEmailLink());
      });

      it(`unknown -> logs error`, () => {
        const originalConsoleError = console.error;
        console.error = jest.fn();
        const provider = 'test';
        component.sign.next({ provider: provider as any });
        expect(console.error).toHaveBeenCalledWith(`Auth provider ${provider} is not supported yet.`);
        console.error = originalConsoleError;
        expect(store.dispatch).not.toHaveBeenCalled();
      });
    });
  });
});
