export enum Environment {
  local = 'local',
  test = 'test',
  staging = 'staging',
  production = 'production',
}

export const API_CONFIG = {
  projectName: `Seed`,
  projectDescription: `Yet another typical startup project template.`,
  projectVersion: `1.0`,
  apiPrefix: 'api',
  projectId: process.env.GCLOUD_PROJECT as string,
  environment: Environment[process.env.NODE_ENV as Environment] || Environment.local,
  dataCenterLocation: process.env.DATA_CENTER_LOCATION as string,
  apiURL: process.env.API_URL as string,
  sentryDSN: process.env.SENTRY_DSN as string,
};

export function isEnv(env: Environment): boolean {
  return env === API_CONFIG.environment;
}
