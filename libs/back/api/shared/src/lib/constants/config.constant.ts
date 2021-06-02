import { Environment } from '@seed/shared/types';

export const API_CONFIG = {
  apiPrefix: 'api',
  apiURL: process.env.API_URL as string,
  dataCenterRegion: process.env.REGION as string,
  environment: Environment[(process.env.NODE_ENV as undefined | Environment) || Environment.development],
  projectId: process.env.PROJECT_ID as string,
  projectName: `Seed`,
  projectDescription: `Yet another typical startup project template.`,
  projectVersion: `1.0`,
  sentryDSN: process.env.SENTRY_DSN as string,
};

export function isEnv(env: Environment): boolean {
  return env === API_CONFIG.environment;
}
