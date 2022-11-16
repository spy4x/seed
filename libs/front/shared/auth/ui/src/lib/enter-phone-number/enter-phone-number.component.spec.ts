import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { ChangeDetectionStrategy, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { testPhoneNumber } from '@seed/shared/mock-data';
import { first } from 'rxjs/operators';
import { EnterPhoneNumberComponent } from './enter-phone-number.component';
import { SharedUIModule } from '@seed/front/shared/ui';

describe(EnterPhoneNumberComponent.name, () => {
  // region SETUP
  let component: EnterPhoneNumberComponent;
  let fixture: ComponentFixture<EnterPhoneNumberComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [EnterPhoneNumberComponent],
      imports: [ReactiveFormsModule, SharedUIModule],
    })
      .overrideComponent(EnterPhoneNumberComponent, {
        set: { changeDetection: ChangeDetectionStrategy.Default }, // To make fixture.detectChanges() work
      })
      .compileComponents();
    fixture = TestBed.createComponent(EnterPhoneNumberComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function getPhoneNumberInput(): DebugElement {
    return fixture.debugElement.query(By.css(`input[data-e2e="phoneNumber"]`));
  }

  function getEnterPhoneNumberButton(): DebugElement {
    return fixture.debugElement.query(By.css(`button[data-e2e="enterPhoneNumber"]`));
  }
  // endregion
  it(`shows validation error if wrong phone number is entered and form submitted`, done => {
    const validPhoneNumber = testPhoneNumber;
    // SETUP: only valid phone number should come
    component.enterPhoneNumber.pipe(first()).subscribe(({ phoneNumber }) => {
      expect(phoneNumber).toEqual(validPhoneNumber);
      done();
    });

    // CASE: invalid
    component.form.setValue({ phoneNumber: 'abc' });
    getEnterPhoneNumberButton().nativeElement.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Phone number is not valid');
    expect(component.form.controls.phoneNumber.valid).toBe(false);

    // CASE: valid
    component.form.setValue({ phoneNumber: validPhoneNumber });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Phone number is not valid');
    expect(component.form.controls.phoneNumber.valid).toBe(true);
    getEnterPhoneNumberButton().nativeElement.click();
  });

  it('disables "Submit" button when inProgress == true and shows "loading"', () => {
    component.inProgress = true;
    fixture.detectChanges();
    expect(getPhoneNumberInput().nativeElement.readOnly).toBe(true);
    expect(getEnterPhoneNumberButton().nativeElement.disabled).toBe(true);
    expect(getEnterPhoneNumberButton().nativeElement.textContent).toContain('Loading');
    // change
    component.inProgress = false;
    fixture.detectChanges();
    expect(getPhoneNumberInput().nativeElement.readOnly).toBe(false);
    expect(getEnterPhoneNumberButton().nativeElement.disabled).toBe(false);
    expect(getEnterPhoneNumberButton().nativeElement.textContent).toContain('Submit');
  });
});
