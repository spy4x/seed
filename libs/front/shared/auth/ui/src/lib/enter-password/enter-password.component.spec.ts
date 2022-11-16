import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EnterPasswordComponent } from './enter-password.component';
import { ReactiveFormsModule } from '@angular/forms';
import { ChangeDetectionStrategy, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { testPassword } from '@seed/shared/mock-data';
import { first } from 'rxjs/operators';
import { SharedUIModule } from '@seed/front/shared/ui';

describe(EnterPasswordComponent.name, () => {
  // region SETUP
  let component: EnterPasswordComponent;
  let fixture: ComponentFixture<EnterPasswordComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [EnterPasswordComponent],
      imports: [ReactiveFormsModule, SharedUIModule],
    })
      .overrideComponent(EnterPasswordComponent, {
        set: { changeDetection: ChangeDetectionStrategy.Default }, // To make fixture.detectChanges() work
      })
      .compileComponents();
    fixture = TestBed.createComponent(EnterPasswordComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function getPasswordInput(): DebugElement {
    return fixture.debugElement.query(By.css(`input[data-e2e="password"]`));
  }

  function getEnterPasswordButton(): DebugElement {
    return fixture.debugElement.query(By.css(`button[data-e2e="enterPassword"]`));
  }
  // endregion
  it(`shows validation error if wrong password is entered and form submitted`, done => {
    const validPassword = testPassword;
    // SETUP: only valid password should come
    component.password.pipe(first()).subscribe(password => {
      expect(password).toEqual(validPassword);
      done();
    });

    // CASE: invalid
    component.form.patchValue({ password: '0000' });
    getEnterPasswordButton().nativeElement.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Min 10 characters long');
    expect(component.form.controls.password.valid).toBe(false);

    // CASE: valid
    component.form.patchValue({ password: validPassword });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Min 10 characters long');
    expect(component.form.controls.password.valid).toBe(true);
    getEnterPasswordButton().nativeElement.click();
  });

  it('disables "Submit" button when inProgress == true and shows "loading" if "isActiveStage"', () => {
    component.inProgress = true;
    component.isActiveStage = true;
    fixture.detectChanges();
    expect(getPasswordInput().nativeElement.readOnly).toBe(true);
    expect(getEnterPasswordButton().nativeElement.disabled).toBe(true);
    expect(getEnterPasswordButton().nativeElement.textContent).toContain('Loading');
    // change
    component.isActiveStage = false;
    fixture.detectChanges();
    expect(getPasswordInput().nativeElement.readOnly).toBe(true);
    expect(getEnterPasswordButton().nativeElement.disabled).toBe(true);
    expect(getEnterPasswordButton().nativeElement.textContent).toContain('Submit');
  });
});
