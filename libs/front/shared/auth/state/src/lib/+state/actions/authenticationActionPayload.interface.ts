import { AuthProvider } from '@seed/front/shared/types';

export interface AuthenticationActionPayload {
  userId: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  isEmailVerified: boolean;
  createdAt: number;
  isNewUser: boolean;
  providers: AuthProvider[];
}
