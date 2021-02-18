module.exports = {
  testMatch: ['**/+(*.)+(spec|test).+(ts|js)?(x)'],
  transform: {
    '^.+\\.(ts|js|html)$': 'ts-jest',
    '\\.(pug)$': 'pug-jest',
  },
  resolver: '@nrwl/jest/plugins/resolver',
  moduleFileExtensions: ['ts', 'js', 'html', 'pug', 'json'],
  coverageReporters: ['html'],
  silent: true, // prevents console.log/error/warn to appear during tests run. To debug run `$ yarn test xxxx --silent=false`
  testTimeout: 10000,
};
