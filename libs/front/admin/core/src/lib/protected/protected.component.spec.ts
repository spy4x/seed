import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProtectedComponent } from './protected.component';
import { NgControl } from '@angular/forms';
import { provideMockStore } from '@ngrx/store/testing';

describe(ProtectedComponent.name, () => {
  let component: ProtectedComponent;
  let fixture: ComponentFixture<ProtectedComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ProtectedComponent],
      providers: [
        provideMockStore(),
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

    fixture = TestBed.createComponent(ProtectedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
