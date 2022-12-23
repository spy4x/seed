import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfileComponent } from './profile.component';
import { Component } from '@angular/core';
import { mockUsers } from '@seed/shared/mock-data';
import { SharedUIModule } from '@seed/front/shared/ui';
import { ReactiveFormsModule } from '@angular/forms';

describe(ProfileComponent.name, () => {
  // region SETUP
  const [testUser] = mockUsers;
  let fixture: ComponentFixture<TestHostComponent>;

  @Component({
    selector: 'shared-auth-ui-test-host',
    template:
      '<shared-auth-ui-profile [user]="user" [isSaving]="isSaving" (signOut)="onSignOut()" (update)="onUpdate($event)"></shared-auth-ui-profile>',
  })
  class TestHostComponent {
    user = testUser;

    isSaving = false;

    onSignOut = jest.fn();

    onUpdate = jest.fn();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ProfileComponent, TestHostComponent],
      imports: [SharedUIModule, ReactiveFormsModule],
    }).compileComponents();
    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  function getElementByE2EAttribute<T extends HTMLElement>(e2eValue: string): T {
    const element = (fixture.debugElement.nativeElement as HTMLElement).querySelector(`[data-e2e="${e2eValue}"]`);

    if (!element) {
      throw new Error(`No element with data-e2e="${e2eValue}" found`);
    }

    return element as unknown as T;
  }

  // endregion

  it(`shows firstName, lastName and photoURL as inputs`, () => {
    const firstNameInput = getElementByE2EAttribute<HTMLInputElement>('firstName');
    const firstNameValue = firstNameInput.value;
    expect(firstNameValue).toEqual(testUser.firstName);

    const lastNameInput = getElementByE2EAttribute<HTMLInputElement>('lastName');
    const lastNameValue = lastNameInput.value;
    expect(lastNameValue).toEqual(testUser.lastName);

    const photoURLInput = getElementByE2EAttribute<HTMLInputElement>('photoURL');
    const photoURLValue = photoURLInput.value;
    expect(photoURLValue).toEqual(testUser.photoURL);
  });

  it.todo(`shows email`);

  it(`emits "signOut" event on SignOutButton click`, () => {
    getElementByE2EAttribute('signOut').click();
    expect(fixture.componentInstance.onSignOut).toHaveBeenCalledTimes(1);
  });

  it(`should not emit "update" event on SubmitButton click, if form is invalid`, () => {
    fixture.componentInstance.user = { ...testUser, firstName: '', lastName: 'def', photoURL: 'ghi' };
    fixture.detectChanges();
    getElementByE2EAttribute('update').click();
    expect(fixture.componentInstance.onUpdate).not.toHaveBeenCalled();
  });

  it(`emits "update" event on SubmitButton click, if form is valid`, () => {
    fixture.componentInstance.user = { ...testUser, firstName: 'abc', lastName: 'def', photoURL: 'ghi' };
    fixture.detectChanges();
    getElementByE2EAttribute('update').click();
    expect(fixture.componentInstance.onUpdate).toHaveBeenCalledWith({
      firstName: 'abc',
      lastName: 'def',
      photoURL: 'ghi',
    });
  });
});
