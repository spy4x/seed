import { exec } from './exec';
import { silenceConsole } from './testing/silenceConsole';

describe('exec', () => {
  silenceConsole('log');

  it('should show proper results of "$ echo aaa" command ', () => {
    expect(exec('echo aaa')).toBe('aaa\n');
  });

  it('should show proper results of "$ git remote" command ', () => {
    expect(exec('git remote')).toBe('origin\n');
  });
});
