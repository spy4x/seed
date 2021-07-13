import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DisplayPrevUserComponent } from './display-prev-user.component';
import { ChangeDetectionStrategy, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';

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

  function getPasswordInput(): DebugElement {
    return fixture.debugElement.query(By.css(`input[data-e2e="password"]`));
  }
  // endregion

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
