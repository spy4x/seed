import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { FirebaseError } from 'firebase-admin/lib/firebase-namespace-api';
import { LogService } from '../log/log.service';

@Injectable()
export class FirebaseAuthService {
  logService = new LogService(FirebaseAuthService.name);

  constructor() {
    if (!admin.apps.length) {
      admin.initializeApp();
    }
  }

  async getUser(userId: string): Promise<null | admin.auth.UserRecord> {
    try {
      return await this.getAuth().getUser(userId);
    } catch (error: unknown) {
      const firebaseError = error as FirebaseError;
      if (firebaseError.code && firebaseError.code === `auth/user-not-found`) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Validates token and returns user id or null (if token is not valid or outdated).
   * @param token JWT
   */
  async validateJWT(token: string): Promise<null | string> {
    const logSegment = this.logService.startSegment(this.validateJWT.name);
    try {
      const decodedToken = await this.getAuth().verifyIdToken(token, true);
      const userId = decodedToken.uid || null;
      logSegment.endWithSuccess();
      return userId;
    } catch (error: unknown) {
      if (error instanceof Error) {
        logSegment.endWithFail(error, {
          token,
        });
      }
      return null;
    }
  }

  async blockUser(userId: string): Promise<void> {
    await this.getAuth().updateUser(userId, { disabled: true });
  }

  async unblockUser(userId: string): Promise<void> {
    await this.getAuth().updateUser(userId, { disabled: false });
  }

  async updateCustomClaims(userId: string, customClaims: { [field: string]: unknown }): Promise<void> {
    return this.logService.trackSegment<void>(this.updateCustomClaims.name, async logSegment => {
      const userRecord = await this.getAuth().getUser(userId);
      const oldClaims = userRecord.customClaims;
      const newClaims = { ...oldClaims, ...customClaims };
      logSegment.log(`Intermediate log`, { oldClaims, newClaims });
      return this.getAuth().setCustomUserClaims(userId, newClaims);
    });
  }

  private getAuth(): admin.auth.Auth {
    return admin.auth();
  }
}
