import { getDeployOnlyArray } from './getDeployOnlyArray';

describe('getDeployOnlyArray', () => {
  it('return "hosting:client, hosting:admin" for "client admin"', () => {
    const input = ['client', 'admin'];
    const output = ['hosting:client', 'hosting:admin'];
    expect(getDeployOnlyArray(input)).toEqual(output);
  });
  it('return "hosting:admin, functions" for "admin firebase-functions"', () => {
    const input = ['admin', 'firebase-functions'];
    const output = ['hosting:admin', 'functions'];
    expect(getDeployOnlyArray(input)).toEqual(output);
  });
  it('return "hosting:client, hosting:admin, functions" for "client admin firebase-functions"', () => {
    const input = ['client', 'admin', 'firebase-functions'];
    const output = ['hosting:client', 'hosting:admin', 'functions'];
    expect(getDeployOnlyArray(input)).toEqual(output);
  });
});
