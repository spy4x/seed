const mockedExec = jest.fn();
jest.mock('./exec', () => ({ exec: mockedExec }));

import { getAffectedApps, getAffectedAppsNamesCommand } from './getAffectedApps';

const getNxOutput = (input: string): string => {
  const string = input
    ? input
        .split(' ')
        .map(i => `\n  - ${i}`)
        .join('')
    : 'No projects affected';
  const result = `
$ nx affected:apps '--base=origin/master~1' --head=origin/master

>  NX  Affected apps:

${string}

✨  Done in 1.89s.`;
  return result;
};
const test = (input: string): void => {
  const expectedOutput = input ? input.split(' ').sort() : [];
  mockedExec.mockReturnValue(getNxOutput(input));
  const output = getAffectedApps();
  expect(mockedExec.mock.calls.length).toBe(1);
  // tslint:disable-next-line:no-unsafe-any
  expect(mockedExec.mock.calls[0][0]).toBe(getAffectedAppsNamesCommand);
  expect(output).toEqual(expectedOutput);
};

describe('getAffectedApps', () => {
  beforeEach(() => mockedExec.mockClear(), 0);

  it('should return empty array in case of no affected apps', () => {
    test('');
  });

  it('should return array with one app in case of one affected app', () => {
    test('front-web-client');
  });

  it('should return array with two apps in case of two affected apps', () => {
    test('front-web-client front-admin');
  });

  it('should return array with three apps in case of three affected apps', () => {
    test('front-web-client front-admin back-cloud-functions');
  });
});
