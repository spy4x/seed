import { exec } from './exec';
import * as chalk from 'chalk';

const consoleLogAmount = {
  default: 2,
  onlyCommand: 1,
  onlyResult: 1,
};

const defaultTestCommand = 'echo aaa';
const defaultTestOutput = 'aaa\n';

describe('exec', () => {
  const consoleLog = console.log;
  const mock = (console.log = jest.fn() as jest.Mock<string>);

  afterAll(() => {
    console.log = consoleLog;
  });

  beforeEach(() => mock.mockClear());

  it('should show proper results of "$ echo aaa" command', () => {
    expect(exec(defaultTestCommand)).toBe(defaultTestOutput);
  });

  it('should show proper results of "$ echo qwerty" command', () => {
    expect(exec('echo qwerty')).toBe('qwerty\n');
  });

  it('by default should call console.log for command and for result', () => {
    expect(exec(defaultTestCommand)).toBe(defaultTestOutput); // returned output
    expect(mock).toHaveBeenCalledTimes(consoleLogAmount.default);
    expect(mock).toHaveBeenCalledWith(chalk.cyan(`\n$ ${defaultTestCommand}`)); // logged command
    expect(mock).toHaveBeenCalledWith(defaultTestOutput); // logged result
  });

  it('should call console.log only for command if turned off for result', () => {
    expect(exec(defaultTestCommand, true, false)).toBe(defaultTestOutput); // returned output
    expect(mock).toHaveBeenCalledTimes(consoleLogAmount.onlyCommand);
    expect(mock).toHaveBeenCalledWith(chalk.cyan(`\n$ ${defaultTestCommand}`)); // logged command
  });

  it('should call console.log only for result if turned off for command', () => {
    expect(exec(defaultTestCommand, false, true)).toBe(defaultTestOutput); // returned output
    expect(mock).toHaveBeenCalledTimes(consoleLogAmount.onlyResult);
    expect(mock).toHaveBeenCalledWith(defaultTestOutput); // logged result
  });
});
