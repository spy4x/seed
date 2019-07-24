import { getDeployOnlyArray } from './+utils/getDeployOnlyArray';
import { getAffectedApps } from '@afs/dev/utils';
import chalk from 'chalk';
import { applyHostingTargets } from './lib/applyHostingTargets';
import { deploy } from './lib/deploy';

export const run = (): void => {
  const affectedApps = getAffectedApps();
  const deployOnlyArray = getDeployOnlyArray(affectedApps);

  console.log(chalk.yellow(`Affected apps:`), affectedApps);
  console.log(chalk.yellow(`Deploy only:`), deployOnlyArray);

  applyHostingTargets(affectedApps);
  deploy(deployOnlyArray);
};
