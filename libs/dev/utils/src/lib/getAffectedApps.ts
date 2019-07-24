import { exec } from './exec';

const line2Index = 1;
const line3Index = 2;

export const getAffectedAppsNamesCommand = 'yarn affected:apps --base=origin/master';

export const getAffectedApps = (): string[] => {
  const stdout = exec(getAffectedAppsNamesCommand);
  const resultLines = stdout.split('\n');
  const secondLine = resultLines[line2Index].trim();
  const affectedAppsString = secondLine.startsWith('$') ? resultLines[line3Index].trim() : secondLine;

  return affectedAppsString ? affectedAppsString.split(' ') : [];
};
