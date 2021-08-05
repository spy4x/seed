import { testDisplayName, testEmail, testJWT, testPhotoURL, testUserId } from '@seed/shared/mock-data';
import { AuthenticationActionPayload } from './actions/authenticationActionPayload.interface';
import { AuthProvider } from '@seed/front/shared/types';
import { MILLISECONDS_IN_SECOND, SECONDS_IN_MINUTE } from '@seed/shared/constants';
import { Observable, of } from 'rxjs';

const thirtyMinutes = 30;
export const mockAuthCredentials = {
  user: {
    uid: testUserId,
    email: testEmail,
    photoURL: testPhotoURL,
    displayName: testDisplayName,
    emailVerified: true,
    metadata: {
      creationTime: new Date(
        new Date().getTime() - thirtyMinutes * SECONDS_IN_MINUTE * MILLISECONDS_IN_SECOND,
      ).toString(),
    },
    providerData: [{ providerId: 'google.com' }, null],
    getIdToken: (): Observable<string> => of(testJWT),
    jwt: testJWT,
  },
  credential: {},
  additionalUserInfo: { isNewUser: false },
};
export const mockExpectedActionPayload: AuthenticationActionPayload = {
  userId: mockAuthCredentials.user.uid,
  email: mockAuthCredentials.user.email,
  displayName: mockAuthCredentials.user.displayName,
  photoURL: mockAuthCredentials.user.photoURL,
  isEmailVerified: mockAuthCredentials.user.emailVerified,
  createdAt: Date.parse(mockAuthCredentials.user.metadata.creationTime),
  isNewUser: mockAuthCredentials.additionalUserInfo.isNewUser,
  providers: [AuthProvider.google],
  jwt: mockAuthCredentials.user.jwt,
};
