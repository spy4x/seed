// tslint:disable:no-unsafe-any

import { run } from './run';
import { deploy } from './lib/deploy';
import { applyHostingTargets } from './lib/applyHostingTargets';
import { getDeployOnlyArray } from './+utils/getDeployOnlyArray';
import * as utils from '@afs/dev/utils';

jest.mock('./lib/deploy');
jest.mock('./lib/applyHostingTargets');
jest.mock('./+utils/getDeployOnlyArray');

const affectedApps = ['client, firebase-functions'];
const deployOnlyArray = getDeployOnlyArray(affectedApps);
const mockedGetAffectedApps: jest.Mock<string[], string[]> = ((utils.getAffectedApps as unknown) = jest.fn(
  () => affectedApps
));
const mockedGetDeployOnlyArray: jest.Mock<typeof getDeployOnlyArray> = ((getDeployOnlyArray as unknown) = jest.fn());
const mockedApplyHostingTargets: jest.Mock<typeof applyHostingTargets> = ((applyHostingTargets as unknown) = jest.fn());
const mockedDeploy: jest.Mock<typeof deploy> = ((deploy as unknown) = jest.fn());

describe('run', () => {
  utils.silenceConsole('log');

  it(`should call all inner mocks properly`, () => {
    run();
    expect(mockedGetAffectedApps.mock.calls.length).toBe(1);
    expect(mockedGetDeployOnlyArray.mock.calls.length).toBe(1);
    expect(mockedGetDeployOnlyArray.mock.calls[0][0]).toBe(affectedApps);
    expect(mockedApplyHostingTargets.mock.calls.length).toBe(1);
    expect(mockedApplyHostingTargets.mock.calls[0][0]).toBe(affectedApps);
    expect(mockedDeploy.mock.calls.length).toBe(1);
    expect(mockedDeploy.mock.calls[0][0]).toBe(deployOnlyArray);
  });
});
