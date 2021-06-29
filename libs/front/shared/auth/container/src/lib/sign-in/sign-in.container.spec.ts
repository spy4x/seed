import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SignInContainer } from './sign-in.container';

describe('SignInContainer', () => {
  let component: SignInContainer;
  let fixture: ComponentFixture<SignInContainer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ SignInContainer ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(SignInContainer);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
