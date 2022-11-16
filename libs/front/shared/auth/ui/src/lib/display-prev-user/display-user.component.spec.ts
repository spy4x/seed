import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DisplayUserComponent } from './display-user.component';
import { ChangeDetectionStrategy, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { testDisplayName, testEmail, testPhotoURL, testUserId } from '@seed/shared/mock-data';
import { first } from 'rxjs/operators';
import { SharedUIModule } from '@seed/front/shared/ui';

describe(DisplayUserComponent.name, () => {
  // region SETUP
  let component: DisplayUserComponent;
  let fixture: ComponentFixture<DisplayUserComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [DisplayUserComponent],
      imports: [SharedUIModule],
    })
      .overrideComponent(DisplayUserComponent, {
        set: { changeDetection: ChangeDetectionStrategy.Default }, // To make fixture.detectChanges() work
      })
      .compileComponents();
    fixture = TestBed.createComponent(DisplayUserComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function getWrapperEl(): DebugElement {
    return fixture.debugElement.query(By.css(`[data-e2e="wrapper"]`));
  }

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

  function getSignOutButton(): DebugElement {
    return fixture.debugElement.query(By.css(`[data-e2e="signOut"]`));
  }

  // endregion

  describe('No email or userId provided', () => {
    it(`hides everything when no email`, () => {
      component.email = undefined;
      fixture.detectChanges();
      expect(getWrapperEl()).toBeFalsy();
    });
    it(`hides everything when no userId`, () => {
      component.userId = undefined;
      fixture.detectChanges();
      expect(getWrapperEl()).toBeFalsy();
    });
  });

  describe('Email or userId provided', () => {
    beforeEach(() => {
      component.email = testEmail;
      component.userId = testUserId;
      fixture.detectChanges();
    });

    it(`shows email`, () => {
      expect(getIdentificationEl().nativeElement.textContent).toContain(testEmail);
    });

    it(`shows userId if no email or displayName`, () => {
      component.email = undefined;
      fixture.detectChanges();
      expect(getIdentificationEl().nativeElement.textContent).toContain(`User: ${testUserId}`);
    });

    it(`shows display name`, () => {
      component.displayName = testDisplayName;
      fixture.detectChanges();
      expect(getDisplayNameEl().nativeElement.textContent).toContain(testDisplayName);
    });

    it(`shows photoURL image or a placeholder`, () => {
      component.photoURL = testPhotoURL;
      fixture.detectChanges();
      expect(getPhotoURLEl().nativeElement.src).toBe(testPhotoURL);
      component.photoURL = undefined;
      fixture.detectChanges();
      expect(getPhotoURLEl().nativeElement.src).toContain('assets/placeholders/avatar.svg');
    });

    it(`shows ChangeUserButton if no userId`, () => {
      expect(getChangeUserButton()).toBeFalsy();
      component.userId = undefined;
      fixture.detectChanges();
      expect(getChangeUserButton().nativeElement.textContent).toContain('Not you?');
    });

    it(`emits "changeUser" event on ChangeUserButton click`, done => {
      component.userId = undefined;
      fixture.detectChanges();
      component.changeUser.pipe(first()).subscribe(() => done());
      getChangeUserButton().nativeElement.click();
    });

    it(`shows SignOutButton if userId is set`, () => {
      expect(getSignOutButton().nativeElement.textContent).toContain('Sign out');
      component.userId = undefined;
      fixture.detectChanges();
      expect(getSignOutButton()).toBeFalsy();
    });

    it(`emits "signOut" event on SignOutButton click`, done => {
      component.signOut.pipe(first()).subscribe(() => done());
      getSignOutButton().nativeElement.click();
    });
  });
});
