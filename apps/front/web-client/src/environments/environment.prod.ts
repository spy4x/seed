import { FrontWebClientConfig } from '@seed/front/web-client/core';
import { Environment } from '@seed/shared/types';

export const config: FrontWebClientConfig = {
  environment: Environment.production,
  firebase: {
    apiKey: 'ENTER_YOUR_VALUE',
    authDomain: 'ENTER_YOUR_VALUE',
    projectId: 'ENTER_YOUR_VALUE',
    storageBucket: 'ENTER_YOUR_VALUE',
    messagingSenderId: 'ENTER_YOUR_VALUE',
    appId: 'ENTER_YOUR_VALUE',
    measurementId: 'ENTER_YOUR_VALUE',
  },
};
