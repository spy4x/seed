import { config } from 'firebase-functions';

export enum Environment {
  local = 'local',
  test = 'test',
  production = 'production',
}

const firebaseConfig = config();

export const API_CONFIG = {
  projectId: process.env.GCLOUD_PROJECT,
  environment:
    process.env.NODE_ENV === 'production'
      ? Environment.production
      : process.env.NODE_ENV === 'test'
      ? Environment.test
      : Environment.local,
  apiPrefix: 'api',
  // Note: you can use "firebaseConfig.some.key" here
};
firebaseConfig.toString(); // TODO: remove when "firebaseConfig" is used somewhere here
