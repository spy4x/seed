import { getFirebaseDeployAuthParams } from './getFirebaseDeployAuthParams';

const vars = {
  project: {
    title: 'FIREBASE_PROJECT_NAME',
    value: 'TEST_FIREBASE_PROJECT_NAME'
  },
  token: {
    title: 'FIREBASE_DEPLOY_TOKEN',
    value: 'TEST_FIREBASE_DEPLOY_TOKEN'
  }
};

describe('getFirebaseDeployAuthParams', () => {
  it('should fail without both env variables set', () => {
    delete process.env[vars.project.title];
    delete process.env[vars.token.title];
    expect(() => getFirebaseDeployAuthParams()).toThrow(`Parameter "FIREBASE_PROJECT_NAME" is not specified`);
  });

  it('should fail without "FIREBASE_DEPLOY_TOKEN" set', () => {
    process.env[vars.project.title] = vars.project.value;
    delete process.env[vars.token.title];
    expect(() => getFirebaseDeployAuthParams()).toThrow(`Parameter "FIREBASE_DEPLOY_TOKEN" is not specified`);
  });

  it('should return proper result with both env variables set', () => {
    process.env[vars.project.title] = vars.project.value;
    process.env[vars.token.title] = vars.token.value;
    expect(getFirebaseDeployAuthParams()).toBe(`--project ${vars.project.value} --token ${vars.token.value}`);
  });
});
