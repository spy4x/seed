// region MUST GO BEFORE IMPORTS
const isEnv = jest.fn();
/* eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion */
jest.mock('../../constants', () => ({ ...(jest.requireActual('../../constants') as any), isEnv }));
const verifyIdToken = jest.fn();
const getUser = jest.fn();
const updateUser = jest.fn();
const setCustomUserClaims = jest.fn();
jest.mock('firebase-admin', () => ({
  apps: [1],
  auth: () => ({ verifyIdToken, getUser, updateUser, setCustomUserClaims }),
}));
// endregion

import { FirebaseAuthService } from './firebaseAuth.service';
import { CACHE_KEYS, CacheTTL } from '../../cache';

describe(FirebaseAuthService.name, () => {
  // region SETUP
  const cache = { wrap: jest.fn() };
  const service = new FirebaseAuthService(cache as any);
  beforeEach(() => {
    cache.wrap.mockReset();
    isEnv.mockReset();
    verifyIdToken.mockReset();
    getUser.mockReset();
    updateUser.mockReset();
  });
  // endregion

  describe(service.getUser.name, () => {
    it('throws error if "getUser()" throws unknown error', async () => {
      const userId = 'user1';
      const error = new Error('bla bla');
      getUser.mockRejectedValueOnce(error);
      await expect(async () => service.getUser(userId)).rejects.toThrow(error);
      expect(getUser).toHaveBeenCalledWith(userId);
    });

    it('returns null if "getUser()" throws "auth/user-not-found" error', async () => {
      const userId = 'user1';
      getUser.mockRejectedValueOnce({ code: 'auth/user-not-found' });
      expect(await service.getUser(userId)).toBe(null);
      expect(getUser).toHaveBeenCalledWith(userId);
    });

    it('returns userRecord', async () => {
      const user = {};
      getUser.mockReturnValueOnce(user);
      const userId = '123';
      expect(await service.getUser(userId)).toBe(user);
      expect(getUser).toHaveBeenCalledWith(userId);
    });
  });

  describe(service.validateJWT.name, () => {
    it(`if jwt is in cache - returns it and doesn't call "getAuth().verifyIdToken()"`, async () => {
      const userId = '123';
      const jwt = 'token';
      cache.wrap.mockReturnValueOnce(userId);
      expect(await service.validateJWT(jwt)).toBe(userId);
      expect(cache.wrap.mock.calls[0][0]).toBe(CACHE_KEYS.jwt(jwt));
      expect(cache.wrap.mock.calls[0][2]).toEqual(CacheTTL.oneHour);
      expect(verifyIdToken).not.toHaveBeenCalled();
    });

    it(`if jwt is not in cache - calls "getAuth().verifyIdToken()"`, async () => {
      const userId = '123';
      const jwt = 'token';
      cache.wrap.mockImplementationOnce((_key, fn) => fn());
      verifyIdToken.mockReturnValueOnce({ uid: userId });
      expect(await service.validateJWT(jwt)).toBe(userId);
      expect(verifyIdToken).toHaveBeenCalledWith(jwt, true);
    });

    it(`returns null if "getAuth().verifyIdToken()" throws error`, async () => {
      const jwt = 'token';
      cache.wrap.mockImplementationOnce((_key, fn) => fn());
      verifyIdToken.mockRejectedValueOnce(new Error());
      expect(await service.validateJWT(jwt)).toBe(null);
      expect(verifyIdToken).toHaveBeenCalledWith(jwt, true);
    });
  });

  it(service.blockUser.name, async () => {
    const userId = '123';
    await service.blockUser(userId);
    expect(updateUser).toHaveBeenCalledWith(userId, { disabled: true });
  });

  it(service.unblockUser.name, async () => {
    const userId = '123';
    await service.unblockUser(userId);
    expect(updateUser).toHaveBeenCalledWith(userId, { disabled: false });
  });

  it(service.updateCustomClaims.name, async () => {
    const userId = '123';
    const newCustomClaims = { field1: true };
    const existingCustomClaims = { field0: false };
    getUser.mockReturnValueOnce({ customClaims: existingCustomClaims });
    await service.updateCustomClaims(userId, newCustomClaims);
    expect(setCustomUserClaims).toHaveBeenCalledWith(userId, { ...existingCustomClaims, ...newCustomClaims });
  });
});
