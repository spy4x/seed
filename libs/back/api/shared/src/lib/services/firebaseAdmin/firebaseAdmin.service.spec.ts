import { FirebaseAdminService } from './firebaseAdmin.service';

describe(FirebaseAdminService.name, () => {
  it('is defined', () => {
    expect(new FirebaseAdminService()).toBeDefined();
  });
});
