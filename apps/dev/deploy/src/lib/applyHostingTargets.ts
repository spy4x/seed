import { ensureParam, exec } from '@afs/dev/utils';
import { getFirebaseDeployAuthParams } from '../+utils/getFirebaseDeployAuthParams';

export const applyHostingTargets = (affectedApps: string[]): void => {
  const map: { [key: string]: string } = {
    admin: ensureParam('FIREBASE_HOSTING_TARGET_ADMIN', process.env.FIREBASE_HOSTING_TARGET_ADMIN),
    client: ensureParam('FIREBASE_HOSTING_TARGET_CLIENT', process.env.FIREBASE_HOSTING_TARGET_CLIENT)
  };

  const auth = getFirebaseDeployAuthParams();

  affectedApps.forEach((appName: string) => {
    const target = map[appName];
    if (target) {
      const applyTargetCommand = `firebase target:apply hosting ${appName} ${target} ${auth}`;
      console.log(exec(applyTargetCommand));
    }
  });
};
