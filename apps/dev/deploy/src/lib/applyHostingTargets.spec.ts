// THIS SHOULD BE BEFORE IMPORTING THE TESTED FUNCTION - BEGIN
const mockedExec = jest.fn((str: string) => str);
const actualUtils = jest.requireActual('@seed/dev/utils');
jest.mock('@seed/dev/utils', () => ({
  ...actualUtils,
  exec: mockedExec,
}));
// THIS SHOULD BE BEFORE IMPORTING THE TESTED FUNCTION - END

import { applyHostingTargets } from './applyHostingTargets';
import * as utils from '@seed/dev/utils';

const vars: utils.TestingEnvironmentVariables = {
  'front-admin-panel': {
    title: 'FIREBASE_HOSTING_TARGET_ADMIN_PANEL',
    value: 'TEST_FIREBASE_HOSTING_TARGET_ADMIN_PANEL',
  },
  'front-web-client': {
    title: 'FIREBASE_HOSTING_TARGET_WEB_CLIENT',
    value: 'TEST_FIREBASE_HOSTING_TARGET_WEB_CLIENT',
  },
  project: {
    title: 'FIREBASE_PROJECT_NAME',
    value: 'TEST_FIREBASE_PROJECT_NAME',
  },
  token: {
    title: 'FIREBASE_DEPLOY_TOKEN',
    value: 'TEST_FIREBASE_DEPLOY_TOKEN',
  },
};

describe('applyHostingTargets', () => {
  const project = `--project ${vars.project.value}`;
  const token = `--token ${vars.token.value}`;
  const command = `firebase target:apply hosting`;
  const getAlias = (input: string[], index: number): string => `${input[index]} ${vars[input[index]].value}`;

  beforeAll(() => {
    Object.values(vars).forEach(
      (variable: utils.TestingEnvironmentVariable) => (process.env[variable.title] = variable.value),
    );
  });

  beforeEach(() => mockedExec.mockClear(), 0);

  it(`shouldn't call exec with zero affected apps`, () => {
    applyHostingTargets([]);
    expect(mockedExec).toHaveBeenCalledTimes(0);
  });

  it('should call exec with front-admin-panel when front-admin-panel is an affected app', () => {
    const input = ['front-admin-panel'];
    const output = `${command} ${getAlias(input, 0)} ${project} ${token}`;
    applyHostingTargets(input);
    expect(mockedExec).toHaveBeenCalledTimes(1);
    expect(mockedExec).toHaveBeenCalledWith(output);
  });

  it('should call exec with web-client and admin-panel when web-client and admin-panel are affected apps', () => {
    const input = ['front-web-client', 'front-admin-panel'];
    const output1 = `${command} ${getAlias(input, 0)} ${project} ${token}`;
    const output2 = `${command} ${getAlias(input, 1)} ${project} ${token}`;
    applyHostingTargets(input);
    expect(mockedExec).toHaveBeenCalledTimes(input.length);
    expect(mockedExec).toHaveBeenCalledWith(output1);
    expect(mockedExec).toHaveBeenCalledWith(output2);
  });
});
