import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GetJwtComponent } from './get-jwt.component';
import { AngularFireAuthModule } from '@angular/fire/auth';
import { AngularFireModule } from '@angular/fire';

describe('GetJwtComponent', () => {
  let component: GetJwtComponent;
  let fixture: ComponentFixture<GetJwtComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [GetJwtComponent],
      imports: [AngularFireModule.initializeApp({}), AngularFireAuthModule],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(GetJwtComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
