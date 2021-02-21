import * as chalk from 'chalk';
import { execSync } from 'child_process';

export const exec = (command: string, shouldLogCommand = true, shouldLogResult = true): string => {
  if (shouldLogCommand) {
    console.log(chalk.cyan(`\n$ ${command}`));
  }
  try {
    // tslint:disable-next-line:no-unsafe-any
    const result = execSync(command).toString();

    if (shouldLogResult) {
      console.log(result);
    }

    // tslint:disable-next-line:no-unsafe-any
    return result;
  } catch (error) {
    if (error.stdout) {
      throw new Error(error.stdout.toString());
    }
    throw error;
  }
};
