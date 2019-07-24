// tslint:disable:no-unsafe-any

import { exec } from './exec';
import { silenceConsole, SilenceConsoleResult } from './testing/silenceConsole';
import chalk from 'chalk';

const consoleLogAmount = {
  default: 2,
  onlyCommand: 1,
  onlyResult: 1
};

const defaultTestCommand = 'echo aaa';
const defaultTestOutput = 'aaa\n';

describe('exec', () => {
  const { mock }: SilenceConsoleResult = silenceConsole('log');

  beforeEach(() => mock.mockClear());

  it('should show proper results of "$ echo aaa" command', () => {
    expect(exec(defaultTestCommand)).toBe(defaultTestOutput);
  });

  it('should show proper results of "$ git remote" command', () => {
    expect(exec('git remote')).toBe('origin\n');
  });

  it('by default should call console.log for command and for result', () => {
    expect(exec(defaultTestCommand)).toBe(defaultTestOutput); // returned output
    expect(mock.mock.calls.length).toBe(consoleLogAmount.default);
    expect(mock.mock.calls[0][0]).toBe(chalk.cyan(`\n$ ${defaultTestCommand}`)); // logged command
    expect(mock.mock.calls[1][0]).toBe(defaultTestOutput); // logged result
  });

  it('should call console.log only for command if turned off for result', () => {
    expect(exec(defaultTestCommand, true, false)).toBe(defaultTestOutput); // returned output
    expect(mock.mock.calls.length).toBe(consoleLogAmount.onlyCommand);
    expect(mock.mock.calls[0][0]).toBe(chalk.cyan(`\n$ ${defaultTestCommand}`)); // logged command
  });

  it('should call console.log only for result if turned off for command', () => {
    expect(exec(defaultTestCommand, false, true)).toBe(defaultTestOutput); // returned output
    expect(mock.mock.calls.length).toBe(consoleLogAmount.onlyResult);
    expect(mock.mock.calls[0][0]).toBe(defaultTestOutput); // logged result
  });
});
