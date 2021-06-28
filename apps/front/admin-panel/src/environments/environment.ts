import { FrontAdminPanelConfig } from '@seed/front/admin-panel/core';
import { Environment } from '@seed/shared/types';

export const config: FrontAdminPanelConfig = {
  environment: Environment.development,
  firebase: {
    apiKey: 'AIzaSyCz4j1dhRj5rt-hJvUdvqXXJAKmIryvVCg',
    authDomain: 'seed-anton.firebaseapp.com',
    projectId: 'seed-anton',
    storageBucket: 'seed-anton.appspot.com',
    messagingSenderId: '439280065103',
    appId: '1:439280065103:web:d97d7c6b4bedff1402e83a',
    measurementId: 'G-TV07XT0RLM',
  },
};
