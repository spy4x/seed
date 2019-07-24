import { getFirebaseDeployAuthParams } from '../+utils/getFirebaseDeployAuthParams';
import { exec } from '@afs/dev/utils';
import chalk from 'chalk';

export const deploy = (deployOnlyArray: string[]): void => {
  if (!deployOnlyArray.length) {
    console.log(chalk.yellow('Nothing to deploy'));

    return;
  }
  const only = deployOnlyArray.join(',');
  const auth = getFirebaseDeployAuthParams();
  const deployCommand = `firebase deploy ${auth} --only ${only}`;
  console.log(exec(deployCommand));
};
