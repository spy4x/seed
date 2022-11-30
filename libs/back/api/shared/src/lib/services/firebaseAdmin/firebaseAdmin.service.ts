import { Injectable } from '@nestjs/common';
import { API_CONFIG } from '../../constants';
import * as admin from 'firebase-admin';
import { Environment } from '@seed/shared/types';

@Injectable()
export class FirebaseAdminService {
  constructor() {
    if (admin.apps.length) {
      throw new Error(
        'Firebase Admin application is already initialized somewhere else in the app. Please check your code and remove other place.',
      );
    }
    admin.initializeApp(
      API_CONFIG.environment === Environment.production ? undefined : { projectId: API_CONFIG.projectId },
    );
  }
}
