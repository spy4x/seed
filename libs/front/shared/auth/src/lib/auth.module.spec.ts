import { async, TestBed } from '@angular/core/testing';
import { AuthModule } from './auth.module';

describe('AuthModule', () => {
  beforeEach(async(() => {
    TestBed.configureTestingModule({
      imports: [AuthModule],
    }).compileComponents();
  }));

  // TODO: Add real tests here.
  //
  // NB: This particular test does not do anything useful.
  //     It does NOT check for correct instantiation of the module.
  it('should have a module definition', () => {
    expect(AuthModule).toBeDefined();
  });
});
