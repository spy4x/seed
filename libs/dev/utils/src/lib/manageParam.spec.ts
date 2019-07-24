import { checkParam, ensureParam } from '@afs/dev/utils';
const param = 'aaa';
const errorMessage = `Parameter "${param}" is not specified`;

describe('checkParam', () => {
  it('should not throw an error for non-empty value', () => {
    expect(checkParam(param, param)).toBe(undefined);
  });

  it('should throw an error for empty string', () => {
    expect(() => checkParam(param, '')).toThrowError(errorMessage);
  });

  it('should throw an error for null', () => {
    expect(() => checkParam(param, null)).toThrowError(errorMessage);
  });

  it('should throw an error for undefined', () => {
    expect(() => checkParam(param, undefined)).toThrowError(errorMessage);
  });
});

describe('ensureParam', () => {
  it('should not throw an error for non-empty value and return the value', () => {
    expect(ensureParam(param, param)).toBe(param);
  });

  it('should throw an error for empty string', () => {
    expect(() => ensureParam(param, '')).toThrowError(errorMessage);
  });

  it('should throw an error for null', () => {
    expect(() => ensureParam(param, null)).toThrowError(errorMessage);
  });

  it('should throw an error for undefined', () => {
    expect(() => ensureParam(param, undefined)).toThrowError(errorMessage);
  });
});
