/* eslint-disable no-console */

import * as chalk from 'chalk';
import { execSync } from 'child_process';
import { Readable } from 'node:stream';

export const exec = (command: string, shouldLogCommand = true, shouldLogResult = true): string => {
  if (shouldLogCommand) {
    console.log(chalk.cyan(`\n$ ${command}`));
  }
  try {
    const result = execSync(command).toString();

    if (shouldLogResult) {
      console.log(result);
    }

    return result;
  } catch (error: unknown) {
    const execError = error as Error & { stdout: null | Readable };
    if (execError.stdout) {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      throw new Error(execError.stdout.toString());
    }
    throw error;
  }
};
