// THIS SHOULD BE BEFORE IMPORTING THE TESTED FUNCTION - BEGIN
const mockedExec = jest.fn((str: string) => str);
const actualUtils = jest.requireActual('@seed/dev/utils');
jest.mock('@seed/dev/utils', () => ({
  ...actualUtils,
  exec: mockedExec,
}));
// THIS SHOULD BE BEFORE IMPORTING THE TESTED FUNCTION - END

import { deploy } from './deploy';
import * as chalk from 'chalk';
import * as utils from '@seed/dev/utils';

const vars: utils.TestingEnvironmentVariables = {
  project: {
    title: 'FIREBASE_PROJECT_NAME',
    value: 'TEST_FIREBASE_PROJECT_NAME',
  },
  token: {
    title: 'FIREBASE_DEPLOY_TOKEN',
    value: 'TEST_FIREBASE_DEPLOY_TOKEN',
  },
};

describe('deploy', () => {
  const mockedConsoleLog = (console.log = jest.fn() as jest.Mock<string>);
  const project = `--project ${vars.project.value}`;
  const token = `--token ${vars.token.value}`;
  const getOnly = (input: string[]): string => `--only ${input.join(',')}`;

  beforeAll(() =>
    Object.values(vars).forEach(
      (variable: utils.TestingEnvironmentVariable) => (process.env[variable.title] = variable.value),
    ),
  );

  beforeEach(() => {
    mockedExec.mockClear();
    mockedConsoleLog.mockClear();
  });

  it(`shouldn't call exec with zero targets for deploy`, () => {
    deploy([], { log: mockedConsoleLog } as any);
    expect(mockedExec).toHaveBeenCalledTimes(0);
    expect(mockedConsoleLog).toHaveBeenCalledWith(chalk.yellow('Nothing to deploy'));
  });

  it('should call exec once with a provided target', () => {
    const input = ['target1'];
    const output = `yarn deploy --force ${project} ${token} ${getOnly(input)}`;
    deploy(input, { log: mockedConsoleLog } as any);
    expect(mockedExec).toHaveBeenCalledTimes(1);
    expect(mockedExec.mock.results[0].value).toContain(output);
  });

  it('should call exec once with two provided targets', () => {
    const input = ['target1', 'target2'];
    const output = `yarn deploy --force ${project} ${token} ${getOnly(input)}`;
    deploy(input, { log: mockedConsoleLog } as any);
    expect(mockedExec).toHaveBeenCalledTimes(1);
    expect(mockedExec.mock.results[0].value).toBe(output);
  });
});
