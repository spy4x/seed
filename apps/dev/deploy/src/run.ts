import { getDeployOnlyArray } from './+utils/getDeployOnlyArray';
import { getAffectedApps } from '@seed/dev/utils';
import * as chalk from 'chalk';
import { applyHostingTargets } from './lib/applyHostingTargets';
import { deploy } from './lib/deploy';
import { LogService } from '@seed/back/api/shared';

const logPrefix = 'DEV:DEPLOY';

export async function run(): Promise<void> {
  const logService = new LogService(logPrefix);
  await logService.trackSegment(run.name, async topLogSegment => {
    const affectedApps = getAffectedApps();
    const deployOnlyArray = getDeployOnlyArray(affectedApps);

    topLogSegment.log(chalk.yellow(`Affected apps:`), affectedApps);
    topLogSegment.log(chalk.yellow(`Deploy only:`), deployOnlyArray);

    await logService.trackSegment<void>(applyHostingTargets.name, () => applyHostingTargets(affectedApps));
    await logService.trackSegment<void>(deploy.name, logSegment => deploy(deployOnlyArray, logSegment));
  });
}
