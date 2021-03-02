import { getFirebaseDeployAuthParams } from '../+utils/getFirebaseDeployAuthParams';
import { exec } from '@seed/dev/utils';
import * as chalk from 'chalk';
import { LogSegment } from '@seed/back/api/shared';

export const deploy = (deployOnlyArray: string[], logSegment: LogSegment): void => {
  if (!deployOnlyArray.length) {
    logSegment.log(chalk.yellow('Nothing to deploy'));
    return;
  }

  const only = deployOnlyArray.join(',');
  const auth = getFirebaseDeployAuthParams();
  const deployCommand = `yarn deploy --force ${auth} --only ${only}`;
  exec(deployCommand);
};
