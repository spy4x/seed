import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AlertComponent } from './alert.component';
import { NgControl } from '@angular/forms';

describe('InputComponent', () => {
  let component: AlertComponent;
  let fixture: ComponentFixture<AlertComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AlertComponent],
      providers: [
        {
          provide: NgControl,
          useValue: {
            valueAccessor: null,
            control: {
              hasValidator: jest.fn(),
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AlertComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
