import { getDeployOnlyArray } from './getDeployOnlyArray';

describe('getDeployOnlyArray', () => {
  it('return "hosting:front-web-client, hosting:admin" for "front-web-client front-admin"', () => {
    const input = ['front-web-client', 'front-admin'];
    const output = ['hosting:front-web-client', 'hosting:front-admin'];
    expect(getDeployOnlyArray(input)).toEqual(output);
  });
  it('return "hosting:admin, functions" for "front-admin back-cloud-functions"', () => {
    const input = ['front-admin', 'back-cloud-functions'];
    const output = ['hosting:front-admin', 'functions'];
    expect(getDeployOnlyArray(input)).toEqual(output);
  });
  it('return "hosting:front-web-client, hosting:admin, functions" for "front-web-client front-admin back-cloud-functions"', () => {
    const input = ['front-web-client', 'front-admin', 'back-cloud-functions'];
    const output = ['hosting:front-web-client', 'hosting:front-admin', 'functions'];
    expect(getDeployOnlyArray(input)).toEqual(output);
  });
});
