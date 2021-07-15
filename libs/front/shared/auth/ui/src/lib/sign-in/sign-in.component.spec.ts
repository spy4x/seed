import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SignInUIComponent } from './sign-in.component';
import { ChangeDetectionStrategy, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { first } from 'rxjs/operators';
import { AuthProvider, AuthStage, UserStatus } from '@seed/front/shared/types';
import { testDisplayName, testEmail, testPassword, testPhoneNumber } from '@seed/shared/mock-data';
import { ProvidersListComponent } from '../providers-list/providers-list.component';
import { EnterEmailComponent } from '../enter-email/enter-email.component';
import { ReactiveFormsModule } from '@angular/forms';
import { EnterPasswordComponent } from '../enter-password/enter-password.component';
import { EnterPhoneNumberComponent } from '../enter-phone-number/enter-phone-number.component';
import { DisplayPrevUserComponent } from '../display-prev-user/display-prev-user.component';

describe(SignInUIComponent.name, () => {
  // region SETUP
  let component: SignInUIComponent;
  let fixture: ComponentFixture<SignInUIComponent>;
  let displayPrevUserComponent: DisplayPrevUserComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [
        SignInUIComponent,
        ProvidersListComponent,
        EnterEmailComponent,
        EnterPasswordComponent,
        EnterPhoneNumberComponent,
        DisplayPrevUserComponent,
      ],
      imports: [ReactiveFormsModule],
    })
      .overrideComponent(SignInUIComponent, {
        set: { changeDetection: ChangeDetectionStrategy.Default }, // To make fixture.detectChanges() work
      })
      .compileComponents();
    fixture = TestBed.createComponent(SignInUIComponent);
    component = fixture.componentInstance;
    displayPrevUserComponent = fixture.debugElement.query(By.directive(DisplayPrevUserComponent)).componentInstance;
    fixture.detectChanges();
  });

  function getSignInButton(method: AuthProvider): DebugElement {
    return fixture.debugElement.query(By.css(`button[data-e2e="${method}"]`));
  }

  function getRestorePasswordButton(): DebugElement {
    return fixture.debugElement.query(By.css(`button[data-e2e="restorePassword"]`));
  }

  function getDeselectProviderButton(): DebugElement {
    return fixture.debugElement.query(By.css(`button[data-e2e="deselectProvider"]`));
  }

  function getErrorMessageElement(): DebugElement {
    return fixture.debugElement.query(By.css(`[data-e2e="errorMessage"]`));
  }

  function getSuccessMessageElement(): DebugElement {
    return fixture.debugElement.query(By.css(`[data-e2e="successMessage"]`));
  }

  // endregion

  describe('General', () => {
    it('shows error message when errorMessage is set', () => {
      //show
      const errorMessage = 'Auth error';
      component.errorMessage = errorMessage;
      fixture.detectChanges();
      expect(getErrorMessageElement().nativeElement.textContent).toContain(errorMessage);
      //hide
      component.errorMessage = undefined;
      fixture.detectChanges();
      expect(getErrorMessageElement()).toBeFalsy();
    });

    it('shows success message when successMessage is set', () => {
      //show
      const successMessage = 'Auth error';
      component.successMessage = successMessage;
      fixture.detectChanges();
      expect(getSuccessMessageElement().nativeElement.textContent).toContain(successMessage);
      //hide
      component.successMessage = undefined;
      fixture.detectChanges();
      expect(getSuccessMessageElement()).toBeFalsy();
    });

    it('link previous user to DisplayPrevUserComponent', () => {
      //show
      const prevUser = { displayName: testDisplayName };
      component.prevUser = prevUser;
      fixture.detectChanges();
      expect(displayPrevUserComponent.user).toBe(prevUser);
      //hide
      component.prevUser = undefined;
      fixture.detectChanges();
      expect(displayPrevUserComponent.user).toBe(undefined);
    });

    it('subscribes to DisplayPrevUserComponent.changeUser event', done => {
      component.changeUser.pipe(first()).subscribe(() => done());
      displayPrevUserComponent.changeUser.emit();
    });
  });

  describe(`Stage: ${AuthStage.initialization}`, () => {
    beforeEach(() => {
      component.stage = AuthStage.initialization;
      fixture.detectChanges();
    });
    it(`shows loading animation`, () => {
      const loadingEl = fixture.debugElement.query(By.css(`[data-e2e="loading"]`)).nativeElement;
      expect(loadingEl instanceof HTMLElement).toBe(true);
    });
  });

  describe(`Stage: ${AuthStage.enteringEmail}`, () => {
    let enterEmailComponent: EnterEmailComponent;
    beforeEach(() => {
      component.stage = AuthStage.enteringEmail;
      fixture.detectChanges();
      enterEmailComponent = fixture.debugElement.query(By.directive(EnterEmailComponent)).componentInstance;
    });

    it(`shows welcome message, EnterEmailComponent and "Try app anonymously"`, () => {
      expect(fixture.nativeElement.textContent).toContain('Welcome!Please enter your email to continue.');
      expect(fixture.debugElement.query(By.directive(EnterEmailComponent))).toBeTruthy();
      expect(getSignInButton(AuthProvider.anonymous).nativeElement.textContent).toContain('Try app anonymously');
    });

    it('emits "signIn(AuthMethods.anonymous)" on "Try app anonymously" button click', done => {
      component.signIn.pipe(first()).subscribe(({ method }) => {
        expect(method).toEqual(AuthProvider.anonymous);
        done();
      });
      getSignInButton(AuthProvider.anonymous).nativeElement.click();
    });

    it(`links email to EnterEmailComponent`, () => {
      component.email = testEmail;
      fixture.detectChanges();
      expect(enterEmailComponent.email).toEqual(testEmail);
      // change
      component.email = 'fake';
      fixture.detectChanges();
      expect(enterEmailComponent.email).toEqual('fake');
    });

    it(`links inProgress to EnterEmailComponent`, () => {
      component.inProgress = false;
      fixture.detectChanges();
      expect(enterEmailComponent.inProgress).toEqual(false);
      // change
      component.inProgress = true;
      fixture.detectChanges();
      expect(enterEmailComponent.inProgress).toEqual(true);
    });

    it(`links isActiveStage to EnterEmailComponent`, () => {
      component.stage = AuthStage.enteringEmail;
      fixture.detectChanges();
      expect(enterEmailComponent.isActiveStage).toEqual(true);
      // change
      component.stage = AuthStage.authenticatingAnonymously;
      fixture.detectChanges();
      expect(enterEmailComponent.isActiveStage).toEqual(false);
      // change
      component.stage = AuthStage.fetchingProviders;
      fixture.detectChanges();
      expect(enterEmailComponent.isActiveStage).toEqual(true);
    });

    it(`subscribes to EnterEmailComponent "enterEmail" event and emits own "enterEmail" event`, done => {
      component.enterEmail.pipe(first()).subscribe(({ email }) => {
        expect(email).toEqual(testEmail);
        done();
      });
      enterEmailComponent.enterEmail.next({ email: testEmail });
    });

    it('disables "Try app anonymously" inProgress == true and shows "loading" when stage === authenticateAnonymously', () => {
      component.inProgress = true;
      component.stage = AuthStage.fetchingProviders;
      fixture.detectChanges();
      expect(getSignInButton(AuthProvider.anonymous).nativeElement.disabled).toBe(true);
      expect(getSignInButton(AuthProvider.anonymous).nativeElement.textContent).toContain('Try app anonymously');
      // change stage
      component.stage = AuthStage.authenticatingAnonymously;
      fixture.detectChanges();
      expect(getSignInButton(AuthProvider.anonymous).nativeElement.disabled).toBe(true);
      expect(getSignInButton(AuthProvider.anonymous).nativeElement.textContent).toContain('Loading');
    });
  });

  describe(`Stage: ${AuthStage.fetchingProviders}`, () => {
    beforeEach(() => {
      component.stage = AuthStage.fetchingProviders;
      fixture.detectChanges();
    });

    it(`still shows EnterEmailComponent and "Try app anonymously" button`, () => {
      expect(fixture.nativeElement.textContent).toContain('Welcome!Please enter your email to continue.');
      expect(fixture.debugElement.query(By.directive(EnterEmailComponent))).toBeTruthy();
      expect(getSignInButton(AuthProvider.anonymous).nativeElement.textContent).toContain('Try app anonymously');
    });
  });

  describe(`Stage: ${AuthStage.choosingProvider}`, () => {
    let providersListComponent: ProvidersListComponent;
    beforeEach(() => {
      component.stage = AuthStage.choosingProvider;
      fixture.detectChanges();
      providersListComponent = fixture.debugElement.query(By.directive(ProvidersListComponent)).componentInstance;
    });

    function subscribesAndEmitsSignInTest(provider: AuthProvider): void {
      it(`subscribes to ProvidersList component "select" event and emits "signIn" for "${provider}" provider`, done => {
        component.signIn.pipe(first()).subscribe(({ method }) => {
          expect(method).toEqual(provider);
          done();
        });
        providersListComponent.select.next(provider);
      });
    }

    function subscribesAndEmitsSelectProviderTest(provider: AuthProvider): void {
      it(`subscribes to ProvidersList component "select" event and emits "signIn" for "${provider}" provider`, done => {
        component.selectProvider.pipe(first()).subscribe(({ method }) => {
          expect(method).toEqual(provider);
          done();
        });
        providersListComponent.select.next(provider);
      });
    }

    it(`links providers to ProvidersList component`, () => {
      component.providers = [AuthProvider.github, AuthProvider.google];
      fixture.detectChanges();
      expect(providersListComponent.providers).toEqual([AuthProvider.github, AuthProvider.google]);
      // change
      component.providers = [AuthProvider.phone, AuthProvider.link];
      fixture.detectChanges();
      expect(providersListComponent.providers).toEqual([AuthProvider.phone, AuthProvider.link]);
    });

    it(`links selectedProvider to ProvidersList component`, () => {
      component.selectedProvider = AuthProvider.github;
      fixture.detectChanges();
      expect(providersListComponent.selectedProvider).toEqual(AuthProvider.github);
      // change
      component.selectedProvider = AuthProvider.link;
      fixture.detectChanges();
      expect(providersListComponent.selectedProvider).toEqual(AuthProvider.link);
    });

    it(`links inProgress to ProvidersList component`, () => {
      component.inProgress = true;
      fixture.detectChanges();
      expect(providersListComponent.inProgress).toEqual(true);
      // change
      component.inProgress = false;
      fixture.detectChanges();
      expect(providersListComponent.inProgress).toEqual(false);
    });

    subscribesAndEmitsSignInTest(AuthProvider.google);
    subscribesAndEmitsSignInTest(AuthProvider.github);
    subscribesAndEmitsSignInTest(AuthProvider.link);
    subscribesAndEmitsSelectProviderTest(AuthProvider.password);
    subscribesAndEmitsSelectProviderTest(AuthProvider.phone);

    it(`shows welcome message for a signingUp user and welcome back for existing one`, () => {
      component.userStatus = UserStatus.signingUp;
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css(`[data-e2e="welcomeNewUser"]`)).nativeElement.textContent).toBe(
        'Welcome to the app!Use any sign up method below.',
      );
      component.userStatus = UserStatus.existing;
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css(`[data-e2e="welcomeExistingUser"]`)).nativeElement.textContent).toBe(
        'Welcome back!Previously you used these sign in methods:',
      );
    });
  });

  describe(`Stage: ${AuthStage.authenticatingWithEmailAndPassword}`, () => {
    let enterPasswordComponent: EnterPasswordComponent;
    beforeEach(() => {
      component.stage = AuthStage.authenticatingWithEmailAndPassword;
      fixture.detectChanges();
      enterPasswordComponent = fixture.debugElement.query(By.directive(EnterPasswordComponent)).componentInstance;
    });

    describe(`${EnterPasswordComponent.name} integration`, () => {
      it(`links inProgress`, () => {
        component.inProgress = true;
        fixture.detectChanges();
        expect(enterPasswordComponent.inProgress).toEqual(true);
        // change
        component.inProgress = false;
        fixture.detectChanges();
        expect(enterPasswordComponent.inProgress).toEqual(false);
      });

      it(`links isActiveStage`, () => {
        component.stage = AuthStage.authenticatingWithEmailAndPassword;
        fixture.detectChanges();
        expect(enterPasswordComponent.isActiveStage).toEqual(true);
        // change
        component.stage = AuthStage.restoringPassword;
        fixture.detectChanges();
        expect(enterPasswordComponent.isActiveStage).toEqual(false);
      });

      it(`subscribes to EnterPasswordComponent "enterPassword" event and emits "signIn(method:Password, password:string)" event`, done => {
        component.signIn.pipe(first()).subscribe(({ method, password }) => {
          expect(method).toEqual(AuthProvider.password);
          expect(password).toEqual(testPassword);
          done();
        });
        enterPasswordComponent.enterPassword.next({ password: testPassword });
      });
    });

    describe(`DeselectProviderButton`, () => {
      it(`shows button (if multiple providers)`, () => {
        // hide
        component.providers = [AuthProvider.password];
        fixture.detectChanges();
        expect(getDeselectProviderButton()).toBeFalsy();
        // show
        component.providers = [AuthProvider.password, AuthProvider.phone];
        fixture.detectChanges();
        expect(getDeselectProviderButton()).toBeTruthy();
      });

      it(`disables button when inProgress == true`, () => {
        component.providers = [AuthProvider.password, AuthProvider.phone];
        component.inProgress = true;
        fixture.detectChanges();
        expect(getDeselectProviderButton().nativeElement.disabled).toBe(true);
        // change
        component.inProgress = false;
        fixture.detectChanges();
        expect(getDeselectProviderButton().nativeElement.disabled).toBe(false);
      });

      it(`emits "deselectProvider" event when the button is clicked`, done => {
        component.providers = [AuthProvider.password, AuthProvider.phone];
        fixture.detectChanges();
        component.deselectProvider.pipe(first()).subscribe(() => done());
        getDeselectProviderButton().nativeElement.click();
      });
    });

    describe(`RestorePasswordButton`, () => {
      it(`shows button`, () => {
        expect(getRestorePasswordButton()).toBeTruthy();
        expect(getRestorePasswordButton().nativeElement.disabled).toBe(false);
        expect(getRestorePasswordButton().nativeElement.textContent).toBe('Forgot password');
      });
      it(`shows emits "restorePassword" event on button click`, done => {
        component.restorePassword.pipe(first()).subscribe(() => done());
        getRestorePasswordButton().nativeElement.click();
      });
    });
  });

  describe(`Stage: ${AuthStage.restoringPassword}`, () => {
    beforeEach(() => {
      component.stage = AuthStage.restoringPassword;
      fixture.detectChanges();
    });

    it('still shows ${EnterPasswordComponent.name}', () => {
      expect(fixture.debugElement.query(By.directive(EnterPasswordComponent))).toBeTruthy();
    });

    it(`shows disabled RestorePasswordButton button with loading state`, () => {
      component.inProgress = true;
      fixture.detectChanges();
      expect(getRestorePasswordButton().nativeElement.disabled).toBe(true);
      expect(getRestorePasswordButton().nativeElement.textContent).toBe('Loading');
    });
  });

  describe(`Stage: ${AuthStage.authenticatingWithPhoneNumber}`, () => {
    let enterPhoneNumberComponent: EnterPhoneNumberComponent;
    beforeEach(() => {
      component.stage = AuthStage.authenticatingWithPhoneNumber;
      fixture.detectChanges();
      enterPhoneNumberComponent = fixture.debugElement.query(By.directive(EnterPhoneNumberComponent)).componentInstance;
    });

    describe(`${EnterPhoneNumberComponent.name} integration`, () => {
      it(`links inProgress`, () => {
        component.inProgress = true;
        fixture.detectChanges();
        expect(enterPhoneNumberComponent.inProgress).toEqual(true);
        // change
        component.inProgress = false;
        fixture.detectChanges();
        expect(enterPhoneNumberComponent.inProgress).toEqual(false);
      });

      it(`subscribes to EnterPhoneNumberComponent "enterPhoneNumber" event and emits "signIn(method:phone, password:string)" event`, done => {
        component.signIn.pipe(first()).subscribe(({ method, phoneNumber }) => {
          expect(method).toEqual(AuthProvider.phone);
          expect(phoneNumber).toEqual(testPhoneNumber);
          done();
        });
        enterPhoneNumberComponent.enterPhoneNumber.next({ phoneNumber: testPhoneNumber });
      });
    });

    describe(`DeselectProviderButton`, () => {
      it(`shows button (if multiple providers)`, () => {
        // hide
        component.providers = [AuthProvider.phone];
        fixture.detectChanges();
        expect(getDeselectProviderButton()).toBeFalsy();
        // show
        component.providers = [AuthProvider.password, AuthProvider.phone];
        fixture.detectChanges();
        expect(getDeselectProviderButton()).toBeTruthy();
      });

      it(`disables button when inProgress == true`, () => {
        component.providers = [AuthProvider.password, AuthProvider.phone];
        component.inProgress = true;
        fixture.detectChanges();
        expect(getDeselectProviderButton().nativeElement.disabled).toBe(true);
        // change
        component.inProgress = false;
        fixture.detectChanges();
        expect(getDeselectProviderButton().nativeElement.disabled).toBe(false);
      });

      it(`emits "deselectProvider" event when the button is clicked`, done => {
        component.providers = [AuthProvider.password, AuthProvider.phone];
        fixture.detectChanges();
        component.deselectProvider.pipe(first()).subscribe(() => done());
        getDeselectProviderButton().nativeElement.click();
      });
    });
  });
});
