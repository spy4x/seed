import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfileComponent } from './profile.component';
import { ChangeDetectionStrategy, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { mockUsers } from '@seed/shared/mock-data';
import { first } from 'rxjs/operators';
import { SharedUIModule } from '@seed/front/shared/ui';
import { ReactiveFormsModule } from '@angular/forms';

describe(ProfileComponent.name, () => {
  // region SETUP
  let component: ProfileComponent;
  let fixture: ComponentFixture<ProfileComponent>;
  const [testUser] = mockUsers;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ProfileComponent],
      imports: [SharedUIModule, ReactiveFormsModule],
    })
      .overrideComponent(ProfileComponent, {
        set: { changeDetection: ChangeDetectionStrategy.Default }, // To make fixture.detectChanges() work
      })
      .compileComponents();
    fixture = TestBed.createComponent(ProfileComponent);
    component = fixture.componentInstance;
    component.user = testUser;
    fixture.detectChanges();
  });

  function getElementByE2EAttribute(e2eValue: string): DebugElement {
    return fixture.debugElement.query(By.css(`[data-e2e="${e2eValue}"]`));
  }

  // endregion

  it(`shows firstName, lastName and photoURL as inputs`, () => {
    // expect an input with e2e attribute = firstName and value = testUser.firstName
    const firstNameInput = getElementByE2EAttribute('firstName');
    const firstNameValue = firstNameInput.nativeElement.value;
    expect(firstNameValue).toEqual(testUser.firstName);
    // TODO: expect an input with e2e attribute = lastName and value = testUser.lastName
    // TODO: expect an input with e2e attribute = photoURL and value = testUser.photoURL
  });

  it.todo(`shows email`);

  it(`emits "signOut" event on SignOutButton click`, done => {
    component.signOut.pipe(first()).subscribe(() => done());
    getElementByE2EAttribute('signOut').nativeElement.click();
  });
});
