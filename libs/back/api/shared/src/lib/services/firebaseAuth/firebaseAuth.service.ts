import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseAuthService {
  constructor() {
    if (!admin.apps.length) {
      admin.initializeApp();
    }
  }

  async getUser(userId: string): Promise<null | admin.auth.UserRecord> {
    try {
      return this.getAuth().getUser(userId);
    } catch (error) {
      if (error.code === `auth/user-not-found`) {
        return null;
      } else {
        throw error;
      }
    }
  }

  /**
   * Validates token and returns user id or null (if token is not valid or outdated).
   * @param token JWT
   */
  async validateJWT(token: string): Promise<null | string> {
    const logPrefix = `FirebaseAuthService.validateJWT()`;
    try {
      const decodedToken = await this.getAuth().verifyIdToken(token, true);
      return decodedToken?.uid || null;
    } catch (error) {
      console.log(logPrefix, `Parsing JWT failed`, {
        token,
        error,
      });
      return null;
    }
  }

  private getAuth(): admin.auth.Auth {
    return admin.auth();
  }

  async blockUser(userId: string): Promise<void> {
    await this.getAuth().updateUser(userId, { disabled: true });
  }

  async unblockUser(userId: string): Promise<void> {
    await this.getAuth().updateUser(userId, { disabled: false });
  }

  async updateCustomClaims(userId: string, customClaims: { [field: string]: unknown }): Promise<void> {
    const userRecord = await this.getAuth().getUser(userId);
    const oldClaims = userRecord.customClaims;
    const newClaims = { ...oldClaims, ...customClaims };
    console.log({ oldClaims, newClaims });
    return this.getAuth().setCustomUserClaims(userId, newClaims);
  }
}
