// Use "import { config } from 'firebase-functions';" here when it's time

export enum Environment {
  local = 'local',
  test = 'test',
  production = 'production',
}

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

export function isEnv(env: Environment): boolean {
  return env === API_CONFIG.environment;
}
