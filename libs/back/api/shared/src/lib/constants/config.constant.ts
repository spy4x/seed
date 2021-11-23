import { Environment } from '@seed/shared/types';

const apiPrefix = 'api';

export const API_CONFIG = {
  apiPrefix,
  dataCenterRegion: process.env.REGION as string,
  environment: Environment[(process.env.NODE_ENV as undefined | Environment) || Environment.development],
  projectId: process.env.PROJECT_ID as string,
  projectName: `Seed`,
  projectDescription: `Yet another typical startup project template.`,
  projectVersion: `1.0`,
  websiteURL: process.env.WEBSITE_URL as string,
  apiURL: (process.env.API_URL as string) || `${process.env.WEBSITE_URL as string}/${apiPrefix}`,
  sentryDSN: process.env.SENTRY_DSN as string,
  redisHost: process.env.REDIS_HOST as string,
  apiKeys: {
    cloudTasks: process.env.API_KEY_CLOUD_TASKS as string,
  },
};

export function isEnv(env: Environment): boolean {
  return env === API_CONFIG.environment;
}
