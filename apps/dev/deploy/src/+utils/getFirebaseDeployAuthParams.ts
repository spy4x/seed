import { ensureParam } from '@seed/dev/utils';

export const getFirebaseDeployAuthParams = (): string => {
  const project = ensureParam('FIREBASE_PROJECT_NAME', process.env.FIREBASE_PROJECT_NAME);
  const token = ensureParam('FIREBASE_DEPLOY_TOKEN', process.env.FIREBASE_DEPLOY_TOKEN);

  return `--project ${project} --token ${token}`;
};
