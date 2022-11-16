import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfileComponent } from './profile.component';
import { ChangeDetectionStrategy, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { mockUsers, testPhotoURL } from '@seed/shared/mock-data';
import { first } from 'rxjs/operators';
import { SharedUIModule } from '@seed/front/shared/ui';

describe(ProfileComponent.name, () => {
  // region SETUP
  let component: ProfileComponent;
  let fixture: ComponentFixture<ProfileComponent>;
  const [testUser] = mockUsers;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ProfileComponent],
      imports: [SharedUIModule],
    })
      .overrideComponent(ProfileComponent, {
        set: { changeDetection: ChangeDetectionStrategy.Default }, // To make fixture.detectChanges() work
      })
      .compileComponents();
    fixture = TestBed.createComponent(ProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function getWrapperEl(): DebugElement {
    return fixture.debugElement.query(By.css(`[data-e2e="profile"]`));
  }

  function getDisplayNameEl(): DebugElement {
    return fixture.debugElement.query(By.css(`[data-e2e="displayName"]`));
  }

  // function getIdentificationEl(): DebugElement {
  //   return fixture.debugElement.query(By.css(`[data-e2e="identification"]`));
  // }

  function getPhotoURLEl(): DebugElement {
    return fixture.debugElement.query(By.css(`img[data-e2e="photoURL"]`));
  }

  function getSignOutButton(): DebugElement {
    return fixture.debugElement.query(By.css(`[data-e2e="signOut"]`));
  }

  // endregion

  it(`hides everything when no user`, () => {
    component.user = undefined;
    fixture.detectChanges();
    expect(getWrapperEl()).toBeFalsy();
  });

  describe('User provided', () => {
    beforeEach(() => {
      component.user = testUser;
      fixture.detectChanges();
    });

    it(`shows firstName or lastName if they are set`, () => {
      component.user = testUser;
      fixture.detectChanges();
      expect(getDisplayNameEl().nativeElement.textContent).toContain(`${testUser.firstName} ${testUser.lastName}`);
    });

    it.todo(`shows email`);

    it(`shows photoURL image or a placeholder`, () => {
      component.user = { ...testUser, photoURL: testPhotoURL };
      fixture.detectChanges();
      expect(getPhotoURLEl().nativeElement.src).toBe(testPhotoURL);
      component.user = { ...testUser, photoURL: '' };
      fixture.detectChanges();
      expect(getPhotoURLEl().nativeElement.src).toContain('assets/placeholders/avatar.svg');
    });

    it(`emits "signOut" event on SignOutButton click`, done => {
      component.signOut.pipe(first()).subscribe(() => done());
      getSignOutButton().nativeElement.click();
    });
  });
});
