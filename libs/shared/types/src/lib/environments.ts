export enum Environment {
  test = 'test', // short-lived environment for running unit- or e2e- tests with mostly emulated services
  dev = 'dev', // short-lived environment for dev/local/staging purposes with partially emulated services
  production = 'production', // long-lived environment with all live services
}
