import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EnterEmailComponent } from './enter-email.component';
import { ChangeDetectionStrategy, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { testEmail } from '@seed/shared/mock-data';
import { first } from 'rxjs/operators';
import { ReactiveFormsModule } from '@angular/forms';

describe(EnterEmailComponent.name, () => {
  // region SETUP
  let component: EnterEmailComponent;
  let fixture: ComponentFixture<EnterEmailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [EnterEmailComponent],
      imports: [ReactiveFormsModule],
    })
      .overrideComponent(EnterEmailComponent, {
        set: { changeDetection: ChangeDetectionStrategy.Default }, // To make fixture.detectChanges() work
      })
      .compileComponents();
    fixture = TestBed.createComponent(EnterEmailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function getEmailInput(): DebugElement {
    return fixture.debugElement.query(By.css(`input[data-e2e="email"]`));
  }

  function getEnterEmailButton(): DebugElement {
    return fixture.debugElement.query(By.css(`button[data-e2e="enterEmail"]`));
  }
  // endregion

  it(`shows validation error if wrong email is entered and form submitted`, done => {
    const validEmail = testEmail;
    // SETUP: only valid email should come
    component.enterEmail.pipe(first()).subscribe(({ email }) => {
      expect(email).toEqual(validEmail);
      done();
    });

    // CASE: invalid email
    component.email = 'invalid email';
    component.ngOnChanges({ email: true } as any);
    getEnterEmailButton().nativeElement.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Make sure email is valid.');
    expect(getEmailInput().nativeElement.classList.contains('is-invalid')).toBe(true);

    // CASE: valid email
    component.email = validEmail;
    component.ngOnChanges({ email: true } as any);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Make sure email is valid.');
    expect(getEmailInput().nativeElement.classList.contains('is-valid')).toBe(true);
    getEnterEmailButton().nativeElement.click();
  });

  it('disables"Continue" button when inProgress == true and shows "loading" if "isActiveStage"', () => {
    component.inProgress = true;
    component.isActiveStage = true;
    fixture.detectChanges();
    expect(getEmailInput().nativeElement.readOnly).toBe(true);
    expect(getEnterEmailButton().nativeElement.disabled).toBe(true);
    expect(getEnterEmailButton().nativeElement.textContent).toContain('Loading');
    // change stage
    component.isActiveStage = false;
    fixture.detectChanges();
    expect(getEmailInput().nativeElement.readOnly).toBe(true);
    expect(getEnterEmailButton().nativeElement.disabled).toBe(true);
    expect(getEnterEmailButton().nativeElement.textContent).toContain('Continue');
  });
});
