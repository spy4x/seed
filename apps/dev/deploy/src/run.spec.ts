// THIS SHOULD BE BEFORE IMPORTING THE TESTED FUNCTION - BEGIN
const affectedApps = ['front-web-client, back-cloud-functions'];
const mockedGetAffectedApps = jest.fn(() => affectedApps);
const actualUtils = jest.requireActual('@seed/dev/utils');
jest.mock('@seed/dev/utils', () => ({
  ...actualUtils,
  getAffectedApps: mockedGetAffectedApps,
}));
// THIS SHOULD BE BEFORE IMPORTING THE TESTED FUNCTION - END

import { run } from './run';
import { deploy } from './lib/deploy';
import { applyHostingTargets } from './lib/applyHostingTargets';
import { getDeployOnlyArray } from './+utils/getDeployOnlyArray';

jest.mock('./lib/deploy');
jest.mock('./lib/applyHostingTargets');
jest.mock('./+utils/getDeployOnlyArray');

const deployOnlyArray = getDeployOnlyArray(affectedApps);
const mockedGetDeployOnlyArray: jest.Mock<typeof getDeployOnlyArray> = ((getDeployOnlyArray as unknown) = jest.fn());
const mockedApplyHostingTargets: jest.Mock<typeof applyHostingTargets> = ((applyHostingTargets as unknown) = jest.fn());
const mockedDeploy: jest.Mock<typeof deploy> = ((deploy as unknown) = jest.fn());

describe('run', () => {
  it(`should call all inner mocks properly`, async () => {
    await run();
    console.log({ deployOnlyArray });
    expect(mockedGetAffectedApps).toHaveBeenCalledTimes(1);
    expect(mockedGetDeployOnlyArray).toHaveBeenCalledTimes(1);
    expect(mockedGetDeployOnlyArray).toHaveBeenCalledWith(affectedApps);
    expect(mockedApplyHostingTargets).toHaveBeenCalledTimes(1);
    expect(mockedApplyHostingTargets).toHaveBeenCalledWith(affectedApps);
    expect(mockedDeploy).toHaveBeenCalledTimes(1);
    expect(mockedDeploy.mock.calls[0][0]).toBe(deployOnlyArray);
  });
});
