import chalk from 'chalk';
import { execSync } from 'child_process';

export const exec = (command: string): string => {
  console.log(chalk.cyan(`\n$ ${command}`));
  // tslint:disable-next-line:no-unsafe-any
  const stdout = execSync(command);

  // tslint:disable-next-line:no-unsafe-any
  return stdout.toString();
};
