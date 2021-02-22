import { exec } from './exec';

export const getAffectedAppsNamesCommand =
  'yarn affected:apps --base=origin/master --head=origin/60-rename-apps-and-libs';

export const getAffectedApps = (): string[] => {
  const stdout = exec(getAffectedAppsNamesCommand, true, false);
  return stdout
    .split('\n')
    .filter(line => line.startsWith('  - '))
    .map(line => line.replace('  - ', ''))
    .sort();
};
