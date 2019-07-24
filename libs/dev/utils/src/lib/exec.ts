import chalk from 'chalk';
import { execSync } from 'child_process';

export const exec = (command: string, shouldLogCommand: boolean = true, shouldLogResult: boolean = true): string => {
  if (shouldLogCommand) {
    console.log(chalk.cyan(`\n$ ${command}`));
  }
  // tslint:disable-next-line:no-unsafe-any
  const result = execSync(command).toString();

  if (shouldLogResult) {
    console.log(result);
  }

  // tslint:disable-next-line:no-unsafe-any
  return result;
};
