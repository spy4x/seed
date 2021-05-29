import { Environment } from '@seed/shared/types';

export const FRONT_WEB_CLIENT_CONFIG_INJECTION_TOKEN = 'FRONT_WEB_CLIENT_CONFIG_INJECTION_TOKEN';

export interface FrontWebClientConfig {
  environment: Environment;
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId: string;
  };
}
