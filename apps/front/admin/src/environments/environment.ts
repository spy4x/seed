import { FrontAdminPanelConfig } from '@seed/front/admin/core';
import { Environment } from '@seed/shared/types';

export const config: FrontAdminPanelConfig = {
  environment: Environment.dev,
  firebase: {
    useEmulator: true,
    apiKey: 'AIzaSyCz4j1dhRj5rt-hJvUdvqXXJAKmIryvVCg',
    authDomain: 'seed-anton.firebaseapp.com',
    projectId: 'replace-me',
    storageBucket: 'seed-anton.appspot.com',
    messagingSenderId: '439280065103',
    appId: '1:439280065103:web:d97d7c6b4bedff1402e83a',
    measurementId: 'G-TV07XT0RLM',
  },
};
