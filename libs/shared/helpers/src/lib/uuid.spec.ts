const mockedResult = 'abc';
const v4mock = jest.fn().mockReturnValue(mockedResult);
jest.mock('uuid', () => ({ v4: v4mock }));

import { getUUID } from './uuid';

describe('getUUID', () => {
  it('should call v4() from "uuid" module', () => {
    expect(getUUID()).toEqual(mockedResult);
    expect(v4mock).toHaveBeenCalled();
  });
});
