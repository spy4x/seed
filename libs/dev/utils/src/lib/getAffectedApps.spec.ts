import { getAffectedApps, getAffectedAppsNamesCommand } from './getAffectedApps';
import { exec } from './exec';

jest.mock('./exec');

const mockedExec: jest.Mock<string> = ((exec as unknown) = jest.fn());
const getNxOutput = (input: string): string =>
  `yarn run v1.16.0\n$ nx affected:apps --base=origin/master\n${input}\n✨  Done in 1.13s.`;
const test = (input: string): void => {
  const expectedOutput = input ? input.split(' ') : [];
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
    test('client');
  });

  it('should return array with two apps in case of two affected apps', () => {
    test('client admin');
  });

  it('should return array with three apps in case of three affected apps', () => {
    test('client admin firebase-functions');
  });
});
