import { Environment } from '@seed/shared/types';

const apiPrefix = 'api';

export const API_CONFIG = {
  environment: process.env['ENV'] ? Environment[process.env['ENV'] as Environment] : Environment.production,
  projectId: process.env['PROJECT_ID'] as string,
  projectName: `Seed`,
  projectDescription: `Yet another typical startup project template.`,
  projectVersion: `1.0`,
  dbConnectionString: process.env['DB_CONNECTION_STRING'] as string,
  dataCenterRegion: process.env['REGION'] as string,
  apiPrefix,
  redisHost: process.env['REDIS_HOST'] as string,
  redisPort: 6379,
  websiteURL: process.env['WEBSITE_URL'] as string,
  apiURL: (process.env['API_URL'] as string) || `${process.env['WEBSITE_URL'] as string}/${apiPrefix}`,
  sentryDSN: process.env['SENTRY_DSN'] as string,
  apiKeys: {
    cloudTasks: process.env['API_KEY_CLOUD_TASKS'] as string,
  },
};

export function isEnv(env: Environment): boolean {
  return env === API_CONFIG.environment;
}
