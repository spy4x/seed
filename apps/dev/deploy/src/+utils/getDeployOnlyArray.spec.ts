import { getDeployOnlyArray } from './getDeployOnlyArray';

describe('getDeployOnlyArray', () => {
  it('return "hosting:client, hosting:admin" for "front-client front-admin"', () => {
    const input = ['front-client', 'front-admin'];
    const output = ['hosting:front-client', 'hosting:front-admin'];
    expect(getDeployOnlyArray(input)).toEqual(output);
  });
  it('return "hosting:admin, functions" for "front-admin back-cloud-functions"', () => {
    const input = ['front-admin', 'back-cloud-functions'];
    const output = ['hosting:front-admin', 'functions'];
    expect(getDeployOnlyArray(input)).toEqual(output);
  });
  it('return "hosting:client, hosting:admin, functions" for "front-client front-admin back-cloud-functions"', () => {
    const input = ['front-client', 'front-admin', 'back-cloud-functions'];
    const output = ['hosting:front-client', 'hosting:front-admin', 'functions'];
    expect(getDeployOnlyArray(input)).toEqual(output);
  });
});
