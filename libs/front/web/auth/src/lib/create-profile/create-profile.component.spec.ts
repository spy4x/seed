import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CreateProfileComponent } from './create-profile.component';
import { provideMockStore } from '@ngrx/store/testing';

describe(CreateProfileComponent.name, () => {
  let component: CreateProfileComponent;
  let fixture: ComponentFixture<CreateProfileComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [CreateProfileComponent],
      providers: [provideMockStore()],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(CreateProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
