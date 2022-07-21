const nxPreset = require('@nrwl/jest/preset').default;

module.exports = {
  ...nxPreset,
  silent: true, // prevents console.log/error/warn to appear during tests run. To debug run `$ yarn test xxxx --silent=false`
  moduleNameMapper: {
    '^lodash-es$': 'lodash',
    '^validator/es/lib/isEmail$': 'validator/lib/isEmail',
    '^validator/es/lib/isMobilePhone$': 'validator/lib/isMobilePhone',
  },
};
