import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SignInUIComponent, SignInUIComponentProvidersList } from './sign-in.component';
import { ChangeDetectionStrategy, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { first } from 'rxjs/operators';
import { AuthProvider, AuthStage } from '@seed/front/shared/types';
import {
  testDisplayName,
  testEmail,
  testPassword,
  testPhoneNumber,
  testPhotoURL,
  testUserId,
} from '@seed/shared/mock-data';
import { ProvidersListComponent } from '../providers-list/providers-list.component';
import { EnterEmailComponent } from '../enter-email/enter-email.component';
import { ReactiveFormsModule } from '@angular/forms';
import { EnterPasswordComponent } from '../enter-password/enter-password.component';
import { EnterPhoneNumberComponent } from '../enter-phone-number/enter-phone-number.component';
import { DisplayUserComponent } from '../display-prev-user/display-user.component';

describe(SignInUIComponent.name, () => {
  // region SETUP
  let component: SignInUIComponent;
  let fixture: ComponentFixture<SignInUIComponent>;
  let displayUserComponent: DisplayUserComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [
        SignInUIComponent,
        ProvidersListComponent,
        EnterEmailComponent,
        EnterPasswordComponent,
        EnterPhoneNumberComponent,
        DisplayUserComponent,
      ],
      imports: [ReactiveFormsModule],
    })
      .overrideComponent(SignInUIComponent, {
        set: { changeDetection: ChangeDetectionStrategy.Default }, // To make fixture.detectChanges() work
      })
      .compileComponents();
    fixture = TestBed.createComponent(SignInUIComponent);
    component = fixture.componentInstance;
    displayUserComponent = fixture.debugElement.query(By.directive(DisplayUserComponent)).componentInstance;
    fixture.detectChanges();
  });

  function getSignInButton(provider: AuthProvider): DebugElement {
    return fixture.debugElement.query(By.css(`button[data-e2e="${provider}"]`));
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

    it('link userId to DisplayUserComponent', () => {
      //show
      component.userId = testUserId;
      fixture.detectChanges();
      expect(displayUserComponent.userId).toBe(testUserId);
      //hide
      component.userId = undefined;
      fixture.detectChanges();
      expect(displayUserComponent.userId).toBe(undefined);
    });

    it('link email to DisplayUserComponent', () => {
      //show
      component.email = testEmail;
      fixture.detectChanges();
      expect(displayUserComponent.email).toBe(testEmail);
      //hide
      component.email = undefined;
      fixture.detectChanges();
      expect(displayUserComponent.email).toBe(undefined);
    });

    it('link displayName to DisplayUserComponent', () => {
      //show
      component.displayName = testDisplayName;
      fixture.detectChanges();
      expect(displayUserComponent.displayName).toBe(testDisplayName);
      //hide
      component.displayName = undefined;
      fixture.detectChanges();
      expect(displayUserComponent.displayName).toBe(undefined);
    });

    it('link photoURL to DisplayUserComponent', () => {
      //show
      component.photoURL = testPhotoURL;
      fixture.detectChanges();
      expect(displayUserComponent.photoURL).toBe(testPhotoURL);
      //hide
      component.photoURL = undefined;
      fixture.detectChanges();
      expect(displayUserComponent.photoURL).toBe(undefined);
    });

    it('subscribes to DisplayUserComponent.changeUser event', done => {
      component.changeUser.pipe(first()).subscribe(() => done());
      displayUserComponent.changeUser.emit();
    });

    it('subscribes to DisplayUserComponent.signOut event', done => {
      component.signOut.pipe(first()).subscribe(() => done());
      displayUserComponent.signOut.emit();
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

    it('emits "signIn(AuthProvider.anonymous)" on "Try app anonymously" button click', done => {
      component.sign.pipe(first()).subscribe(({ provider: provider }) => {
        expect(provider).toEqual(AuthProvider.anonymous);
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
      component.stage = AuthStage.signingAnonymously;
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
      component.stage = AuthStage.signingAnonymously;
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
    // region SETUP
    beforeEach(() => {
      component.stage = AuthStage.choosingProvider;
      fixture.detectChanges();
    });
    function getProvidersListComponent(list: SignInUIComponentProvidersList): ProvidersListComponent {
      return fixture.debugElement.query(By.css(`[data-e2e="${list}"]`)).componentInstance;
    }

    function testLinksSelectedProvider(list: SignInUIComponentProvidersList): void {
      it(`links selectedProvider to "${list}" ProvidersList component`, () => {
        component.selectedProvider = AuthProvider.github;
        fixture.detectChanges();
        expect(getProvidersListComponent(list).selectedProvider).toEqual(AuthProvider.github);
        // change
        component.selectedProvider = AuthProvider.link;
        fixture.detectChanges();
        expect(getProvidersListComponent(list).selectedProvider).toEqual(AuthProvider.link);
      });
    }

    function testLinksInProgress(list: SignInUIComponentProvidersList): void {
      it(`links inProgress to "${list}" ProvidersList component`, () => {
        component.inProgress = true;
        fixture.detectChanges();
        expect(getProvidersListComponent(list).inProgress).toEqual(true);
        // change
        component.inProgress = false;
        fixture.detectChanges();
        expect(getProvidersListComponent(list).inProgress).toEqual(false);
      });
    }

    function testSubscribesAndEmitsSignIn(p: AuthProvider, list: SignInUIComponentProvidersList): void {
      it(`subscribes to ProvidersList component "select" event and emits "signIn" for "${p}" provider`, done => {
        component.sign.pipe(first()).subscribe(({ provider }) => {
          expect(provider).toEqual(p);
          done();
        });
        getProvidersListComponent(list).selectProvider.next(p);
      });
    }

    function testSubscribesAndEmitsSelectProvider(provider: AuthProvider, list: SignInUIComponentProvidersList): void {
      it(`subscribes to ProvidersList component "select" event and emits "signIn" for "${provider}" provider`, done => {
        component.selectProvider.pipe(first()).subscribe(({ provider: p }) => {
          expect(p).toEqual(provider);
          done();
        });
        getProvidersListComponent(list).selectProvider.next(provider);
      });
    }
    // endregion

    describe('Existing user', () => {
      beforeEach(() => {
        component.isNewUser = false;
        fixture.detectChanges();
      });

      it(`shows "welcome back" message`, () => {
        expect(
          fixture.debugElement.query(By.css(`[data-e2e="welcomeExistingUser"]`)).nativeElement.textContent,
        ).toContain('Welcome back!Please finish your sign in with one of previously used options:');
      });

      describe(`${SignInUIComponentProvidersList.used} ProvidersList`, () => {
        const list = SignInUIComponentProvidersList.used;
        it(`links providers to "${list}" ProvidersList`, () => {
          component.providers = [AuthProvider.github, AuthProvider.google];
          fixture.detectChanges();
          expect(getProvidersListComponent(list).providers).toEqual([AuthProvider.github, AuthProvider.google]);
          // change
          component.providers = [AuthProvider.phone, AuthProvider.link];
          fixture.detectChanges();
          expect(getProvidersListComponent(list).providers).toEqual([AuthProvider.phone, AuthProvider.link]);
        });

        testLinksSelectedProvider(list);
        testLinksInProgress(list);
        testSubscribesAndEmitsSignIn(AuthProvider.google, list);
        testSubscribesAndEmitsSignIn(AuthProvider.github, list);
        testSubscribesAndEmitsSignIn(AuthProvider.link, list);
        testSubscribesAndEmitsSelectProvider(AuthProvider.password, list);
        testSubscribesAndEmitsSelectProvider(AuthProvider.phone, list);
      });

      describe(`${SignInUIComponentProvidersList.alternative} ProvidersList`, () => {
        const list = SignInUIComponentProvidersList.alternative;
        beforeEach(() => {
          component.providers = [AuthProvider.google, AuthProvider.phone];
          component.ngOnChanges({ providers: true } as any);
          fixture.detectChanges();
        });

        it(`links alternativeProviders to  ProvidersList component`, () => {
          expect(component.alternativeProviders).toEqual([AuthProvider.password, AuthProvider.link]);
          expect(getProvidersListComponent(list).providers).toEqual(component.alternativeProviders);
        });

        testLinksSelectedProvider(list);
        testLinksInProgress(list);
        testSubscribesAndEmitsSignIn(AuthProvider.google, list);
        testSubscribesAndEmitsSignIn(AuthProvider.github, list);
        testSubscribesAndEmitsSignIn(AuthProvider.link, list);
        testSubscribesAndEmitsSelectProvider(AuthProvider.password, list);
        testSubscribesAndEmitsSelectProvider(AuthProvider.phone, list);
      });
    });

    describe('New user', () => {
      const list = SignInUIComponentProvidersList.all;
      beforeEach(() => {
        component.isNewUser = true;
        fixture.detectChanges();
      });

      it(`shows "welcome" message`, () => {
        expect(fixture.debugElement.query(By.css(`[data-e2e="welcomeNewUser"]`)).nativeElement.textContent).toContain(
          `It seems that we don't know each other yet.Choose a way to finish sign up:`,
        );
      });

      it(`links allProviders to "all" ProvidersList`, () => {
        expect(getProvidersListComponent(list).providers).toEqual(component.allProviders);
      });

      testLinksSelectedProvider(list);
      testLinksInProgress(list);
      testSubscribesAndEmitsSignIn(AuthProvider.google, list);
      testSubscribesAndEmitsSignIn(AuthProvider.github, list);
      testSubscribesAndEmitsSignIn(AuthProvider.link, list);
      testSubscribesAndEmitsSelectProvider(AuthProvider.password, list);
      testSubscribesAndEmitsSelectProvider(AuthProvider.phone, list);
    });
  });

  describe(`Stage: ${AuthStage.signingEmailAndPassword}`, () => {
    let enterPasswordComponent: EnterPasswordComponent;
    beforeEach(() => {
      component.stage = AuthStage.signingEmailAndPassword;
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
        component.stage = AuthStage.signingEmailAndPassword;
        fixture.detectChanges();
        expect(enterPasswordComponent.isActiveStage).toEqual(true);
        // change
        component.stage = AuthStage.restoringPassword;
        fixture.detectChanges();
        expect(enterPasswordComponent.isActiveStage).toEqual(false);
      });

      it(`subscribes to EnterPasswordComponent "enterPassword" event and emits "sign(provider:password, password)"`, done => {
        fixture.detectChanges();
        component.sign.pipe(first()).subscribe(({ provider: provider, password }) => {
          expect(provider).toEqual(AuthProvider.password);
          expect(password).toEqual(testPassword);
          done();
        });
        enterPasswordComponent.enterPassword.next({ password: testPassword });
      });
    });

    describe(`DeselectProviderButton`, () => {
      it(`shows button`, () => {
        expect(getDeselectProviderButton()).toBeTruthy();
      });

      it(`disables button when inProgress == true`, () => {
        component.inProgress = true;
        fixture.detectChanges();
        expect(getDeselectProviderButton().nativeElement.disabled).toBe(true);
        // change
        component.inProgress = false;
        fixture.detectChanges();
        expect(getDeselectProviderButton().nativeElement.disabled).toBe(false);
      });

      it(`emits "deselectProvider" event when the button is clicked`, done => {
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

    it(`still shows ${EnterPasswordComponent.name}`, () => {
      expect(fixture.debugElement.query(By.directive(EnterPasswordComponent))).toBeTruthy();
    });

    it(`shows disabled RestorePasswordButton button with loading state`, () => {
      component.inProgress = true;
      fixture.detectChanges();
      expect(getRestorePasswordButton().nativeElement.disabled).toBe(true);
      expect(getRestorePasswordButton().nativeElement.textContent).toBe('Loading');
    });
  });

  describe(`Stage: ${AuthStage.signingPhoneNumber}`, () => {
    let enterPhoneNumberComponent: EnterPhoneNumberComponent;
    beforeEach(() => {
      component.stage = AuthStage.signingPhoneNumber;
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

      it(`subscribes to EnterPhoneNumberComponent "enterPhoneNumber" event and emits "signIn(provider:phone, password:string)" event`, done => {
        component.sign.pipe(first()).subscribe(({ provider: provider, phoneNumber }) => {
          expect(provider).toEqual(AuthProvider.phone);
          expect(phoneNumber).toEqual(testPhoneNumber);
          done();
        });
        enterPhoneNumberComponent.enterPhoneNumber.next({ phoneNumber: testPhoneNumber });
      });
    });

    describe(`DeselectProviderButton`, () => {
      it(`shows button`, () => {
        expect(getDeselectProviderButton()).toBeTruthy();
      });

      it(`disables button when inProgress == true`, () => {
        component.inProgress = true;
        fixture.detectChanges();
        expect(getDeselectProviderButton().nativeElement.disabled).toBe(true);
        // change
        component.inProgress = false;
        fixture.detectChanges();
        expect(getDeselectProviderButton().nativeElement.disabled).toBe(false);
      });

      it(`emits "deselectProvider" event when the button is clicked`, done => {
        component.deselectProvider.pipe(first()).subscribe(() => done());
        getDeselectProviderButton().nativeElement.click();
      });
    });
  });
});
