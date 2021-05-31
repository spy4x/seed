import { Environment } from '@seed/shared/types';

export const API_CONFIG = {
  projectName: `Seed`,
  projectDescription: `Yet another typical startup project template.`,
  projectVersion: `1.0`,
  apiPrefix: 'api',
  projectId: process.env.GOOGLE_PROJECT_ID as string,
  environment: Environment[(process.env.NODE_ENV as undefined | Environment) || Environment.development],
  dataCenterLocation: process.env.DATA_CENTER_LOCATION as string,
  apiURL: process.env.API_URL as string,
  sentryDSN: process.env.SENTRY_DSN as string,
};

export function isEnv(env: Environment): boolean {
  return env === API_CONFIG.environment;
}
