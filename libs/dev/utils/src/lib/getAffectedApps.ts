import { exec } from './exec';

export const getAffectedAppsNamesCommand = 'yarn affected:apps --base=origin/master~1 --head=origin/master';

export const getAffectedApps = (): string[] => {
  const stdout = exec(getAffectedAppsNamesCommand, true, false);
  return stdout
    .split('\n')
    .filter(line => line.startsWith('  - '))
    .map(line => line.replace('  - ', ''));
};
