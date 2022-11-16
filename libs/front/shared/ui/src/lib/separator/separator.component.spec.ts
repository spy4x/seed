import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SeparatorComponent } from './separator.component';
import { NgControl } from '@angular/forms';

describe('InputComponent', () => {
  let component: SeparatorComponent;
  let fixture: ComponentFixture<SeparatorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SeparatorComponent],
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

    fixture = TestBed.createComponent(SeparatorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
