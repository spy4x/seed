// tslint:disable:no-unsafe-any

import { deploy } from './deploy';
import * as utils from '@afs/dev/utils';
import chalk from 'chalk';

const mockedExec: jest.Mock<string> = ((utils.exec as unknown) = jest.fn((str: string) => str));

const vars: utils.TestingEnvironmentVariables = {
  project: {
    title: 'FIREBASE_PROJECT_NAME',
    value: 'TEST_FIREBASE_PROJECT_NAME'
  },
  token: {
    title: 'FIREBASE_DEPLOY_TOKEN',
    value: 'TEST_FIREBASE_DEPLOY_TOKEN'
  }
};

describe('deploy', () => {
  utils.silenceConsole('log');
  // tslint:disable-next-line:no-console no-unbound-method
  const mockedConsoleLog = console.log as jest.Mock<string>;

  const project = `--project ${vars.project.value}`;
  const token = `--token ${vars.token.value}`;
  const getOnly = (input: string[]): string => `--only ${input.join(',')}`;

  beforeAll(() =>
    Object.values(vars).forEach(
      (variable: utils.TestingEnvironmentVariable) => (process.env[variable.title] = variable.value)
    )
  );

  beforeEach(() => mockedExec.mockClear(), 0);

  it(`shouldn't call exec with zero targets for deploy`, () => {
    deploy([]);
    expect(mockedExec.mock.calls.length).toBe(0);
    expect(mockedConsoleLog.mock.calls[0][0]).toBe(chalk.yellow('Nothing to deploy'));
  });

  it('should call exec once with a provided target', () => {
    const input = ['target1'];
    const output = `firebase deploy ${project} ${token} ${getOnly(input)}`;
    deploy(input);
    expect(mockedExec.mock.calls.length).toBe(1);
    expect(mockedExec.mock.results[0].value).toContain(output);
  });

  it('should call exec once with two provided targets', () => {
    const input = ['target1', 'target2'];
    const output = `firebase deploy ${project} ${token} ${getOnly(input)}`;
    deploy(input);
    expect(mockedExec.mock.calls.length).toBe(1);
    expect(mockedExec.mock.results[0].value).toBe(output);
  });
});
