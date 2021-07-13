import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  DisplayPrevUserComponent,
  DisplayPrevUserComponent_PHOTO_URL_PLACEHOLDER,
} from './display-prev-user.component';
import { ChangeDetectionStrategy, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { testDisplayName, testEmail, testPhoneNumber, testPhotoURL } from '@seed/shared/mock-data';
import { first } from 'rxjs/operators';

describe(DisplayPrevUserComponent.name, () => {
  // region SETUP
  let component: DisplayPrevUserComponent;
  let fixture: ComponentFixture<DisplayPrevUserComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [DisplayPrevUserComponent],
    })
      .overrideComponent(DisplayPrevUserComponent, {
        set: { changeDetection: ChangeDetectionStrategy.Default }, // To make fixture.detectChanges() work
      })
      .compileComponents();
    fixture = TestBed.createComponent(DisplayPrevUserComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function getDisplayNameEl(): DebugElement {
    return fixture.debugElement.query(By.css(`[data-e2e="displayName"]`));
  }

  function getIdentificationEl(): DebugElement {
    return fixture.debugElement.query(By.css(`[data-e2e="identification"]`));
  }

  function getPhotoURLEl(): DebugElement {
    return fixture.debugElement.query(By.css(`img[data-e2e="photoURL"]`));
  }

  function getChangeUserButton(): DebugElement {
    return fixture.debugElement.query(By.css(`[data-e2e="changeUser"]`));
  }
  // endregion

  it(`shows display name`, () => {
    component.user = { displayName: testDisplayName };
    fixture.detectChanges();
    expect(getDisplayNameEl().nativeElement.textContent).toContain(testDisplayName);
  });

  it(`shows photoURL image or a placeholder`, () => {
    component.user = { photoURL: testPhotoURL };
    fixture.detectChanges();
    expect(getPhotoURLEl().nativeElement.src).toBe(testPhotoURL);
    component.user = {};
    fixture.detectChanges();
    expect(getPhotoURLEl().nativeElement.src).toBe(DisplayPrevUserComponent_PHOTO_URL_PLACEHOLDER);
  });

  it(`shows email`, () => {
    component.user = { email: testEmail };
    fixture.detectChanges();
    expect(getIdentificationEl().nativeElement.textContent).toContain(testEmail);
  });

  it(`shows phone number`, () => {
    component.user = { phoneNumber: testPhoneNumber };
    fixture.detectChanges();
    expect(getIdentificationEl().nativeElement.textContent).toContain(testPhoneNumber);
  });

  it(`shows ChangeUserButton if user is presented`, () => {
    component.user = {};
    fixture.detectChanges();
    expect(getChangeUserButton().nativeElement.textContent).toContain('Not you?');
  });

  it(`emits "changeUser" event on ChangeUserButton click`, done => {
    component.user = {};
    fixture.detectChanges();
    component.changeUser.pipe(first()).subscribe(() => done());
    getChangeUserButton().nativeElement.click();
  });
});
