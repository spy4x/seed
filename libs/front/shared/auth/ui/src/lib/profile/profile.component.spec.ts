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
    const lastNameInput = getElementByE2EAttribute('lastName');
    const lastNameValue = lastNameInput.nativeElement.value;
    expect(lastNameValue).toEqual(testUser.lastName);
    // TODO: expect an input with e2e attribute = photoURL and value = testUser.photoURL
    const photoURLInput = getElementByE2EAttribute('photoURL');
    const photoURLValue = photoURLInput.nativeElement.value;
    expect(photoURLValue).toEqual(testUser.photoURL);
  });

  it.todo(`shows email`);

  it(`emits "signOut" event on SignOutButton click`, done => {
    component.signOut.pipe(first()).subscribe(() => done());
    getElementByE2EAttribute('signOut').nativeElement.click();
  });

  it(`should not emit "update" event on SubmitButton click, if form is invalid`, done => {
    component.user = { ...testUser, firstName: '', lastName: 'def', photoURL: 'ghi' };
    component.update.pipe(first()).subscribe(() => {
      done.fail(new Error(`“update” output should not emit a value if form is invalid`));
    });
    getElementByE2EAttribute('update').nativeElement.click();
    setTimeout(() => done(), 100);
  });

  it(`emits "update" event on SubmitButton click, if form is valid`, done => {
    component.user = { ...testUser, firstName: 'abc', lastName: 'def', photoURL: 'ghi' };
    component.update.pipe(first()).subscribe(user => {
      expect(user.firstName).toEqual('abc');
      expect(user.lastName).toEqual('def');
      expect(user.photoURL).toEqual('ghi');
      done();
    });
    getElementByE2EAttribute('update').nativeElement.click();
  });
});
