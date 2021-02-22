import { getDeployOnlyArray } from './getDeployOnlyArray';

describe('getDeployOnlyArray', () => {
  it('return "hosting:front-web-client, hosting:admin-panel" for "front-web-client front-admin-panel"', () => {
    const input = ['front-web-client', 'front-admin-panel'];
    const output = ['hosting:front-web-client', 'hosting:front-admin-panel'];
    expect(getDeployOnlyArray(input)).toEqual(output);
  });
  it('return "hosting:front-admin-panel, functions" for "front-admin-panel back-cloud-functions"', () => {
    const input = ['front-admin-panel', 'back-cloud-functions'];
    const output = ['hosting:front-admin-panel', 'functions'];
    expect(getDeployOnlyArray(input)).toEqual(output);
  });
  it('return "hosting:front-web-client, hosting:front-admin-panel, functions" for "front-web-client front-admin-panel back-cloud-functions"', () => {
    const input = ['front-web-client', 'front-admin-panel', 'back-cloud-functions'];
    const output = ['hosting:front-web-client', 'hosting:front-admin-panel', 'functions'];
    expect(getDeployOnlyArray(input)).toEqual(output);
  });
});
