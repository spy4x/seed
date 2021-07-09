import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SignInUIComponent } from './sign-in.component';
import { ChangeDetectionStrategy, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { first } from 'rxjs/operators';
import { AuthMethods } from '@seed/front/shared/types';
import { testEmail, testPassword } from '@seed/shared/mock-data';

describe(SignInUIComponent.name, () => {
  let component: SignInUIComponent;
  let fixture: ComponentFixture<SignInUIComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SignInUIComponent],
    })
      .overrideComponent(SignInUIComponent, {
        set: { changeDetection: ChangeDetectionStrategy.Default }, // To make fixture.detectChanges() work
      })
      .compileComponents();
    fixture = TestBed.createComponent(SignInUIComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function getSignInButton(method: AuthMethods): DebugElement {
    return fixture.debugElement.query(By.css(`button[data-e2e="${method}"]`));
  }
  function getSignUpButton(): DebugElement {
    return fixture.debugElement.query(By.css(`button[data-e2e="signUp"]`));
  }
  function getSignOutButton(): DebugElement {
    return fixture.debugElement.query(By.css(`button[data-e2e="signOut"]`));
  }
  function getRestorePasswordButton(): DebugElement {
    return fixture.debugElement.query(By.css(`button[data-e2e="restorePassword"]`));
  }
  function getErrorMessageElement(): DebugElement {
    return fixture.debugElement.query(By.css(`[data-e2e="errorMessage"]`));
  }
  function getSuccessMessageElement(): DebugElement {
    return fixture.debugElement.query(By.css(`[data-e2e="successMessage"]`));
  }

  it('shows loading animation when isAuthenticating == true', () => {
    component.isAuthenticating = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Authenticating...');
  });

  it('shows "Welcome back!" message and "Sign out" button when isAuthenticated == true', () => {
    component.isAuthenticated = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Welcome back!');
    expect(getSignOutButton().nativeElement.textContent).toContain('Sign out');
  });

  it('shows "Welcome!" message and "Sign in anonymously" button when isAuthenticated == false', () => {
    component.isAuthenticated = false;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Welcome!');
    expect(getSignInButton(AuthMethods.anonymous).nativeElement.textContent).toContain('Try app anonymously');
  });

  it('shows error message on Sign In screen when errorMessage is set', () => {
    component.isAuthenticating = false;
    const errorMessage = 'Wrong password';
    component.errorMessage = errorMessage;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Welcome!');
    expect(getErrorMessageElement().nativeElement.textContent).toContain(errorMessage);

    component.errorMessage = undefined;
    fixture.detectChanges();
    expect(getErrorMessageElement()).toBeFalsy();
  });

  it('shows success message on Sign In screen when successMessage is set', () => {
    component.isAuthenticating = false;
    const successMessage = 'Password reset!';
    component.successMessage = successMessage;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Welcome!');
    expect(getSuccessMessageElement().nativeElement.textContent).toContain(successMessage);

    component.successMessage = undefined;
    fixture.detectChanges();
    expect(getSuccessMessageElement()).toBeFalsy();
  });

  it('emits "signIn(AuthMethods.anonymous)" on "Try app anonymously" button click', done => {
    component.signIn.pipe(first()).subscribe(({ method }) => {
      expect(method).toEqual(AuthMethods.anonymous);
      done();
    });
    getSignInButton(AuthMethods.anonymous).nativeElement.click();
  });

  it('emits "signIn(AuthMethods.google)" on "Google" button click', done => {
    component.signIn.pipe(first()).subscribe(({ method }) => {
      expect(method).toEqual(AuthMethods.google);
      done();
    });
    getSignInButton(AuthMethods.google).nativeElement.click();
  });

  it('emits "signIn(AuthMethods.github)" on "GitHub" button click', done => {
    component.signIn.pipe(first()).subscribe(({ method }) => {
      expect(method).toEqual(AuthMethods.github);
      done();
    });
    getSignInButton(AuthMethods.github).nativeElement.click();
  });

  it('emits "signIn(AuthMethods.password, email, password)" on "Sign in" button click', done => {
    component.signIn.pipe(first()).subscribe(({ method, email, password }) => {
      expect(method).toEqual(AuthMethods.password);
      expect(email).toEqual(testEmail);
      expect(password).toEqual(testPassword);
      done();
    });
    fixture.debugElement.query(By.css(`input[data-e2e="email"]`)).nativeElement.value = testEmail;
    fixture.debugElement.query(By.css(`input[data-e2e="password"]`)).nativeElement.value = testPassword;
    getSignInButton(AuthMethods.password).nativeElement.click();
  });

  it('emits "signUp(email, password)" on "Sign Un" button click', done => {
    component.signUp.pipe(first()).subscribe(({ email, password }) => {
      expect(email).toEqual(testEmail);
      expect(password).toEqual(testPassword);
      done();
    });
    fixture.debugElement.query(By.css(`input[data-e2e="email"]`)).nativeElement.value = testEmail;
    fixture.debugElement.query(By.css(`input[data-e2e="password"]`)).nativeElement.value = testPassword;
    getSignUpButton().nativeElement.click();
  });

  it('emits "restorePassword(email)" on "Restore" button click', done => {
    component.restorePassword.pipe(first()).subscribe(({ email }) => {
      expect(email).toEqual(testEmail);
      done();
    });
    fixture.debugElement.query(By.css(`input[data-e2e="email"]`)).nativeElement.value = testEmail;
    getRestorePasswordButton().nativeElement.click();
  });

  it('emits "signOut" on "Sign out" button click', done => {
    component.isAuthenticated = true;
    fixture.detectChanges();
    component.signOut.pipe(first()).subscribe(() => done());
    getSignOutButton().nativeElement.click();
  });
});
