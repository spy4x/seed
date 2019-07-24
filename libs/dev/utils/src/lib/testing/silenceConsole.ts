// tslint:disable:no-unsafe-any no-any
/**
 * Silences console[method] for current test and returns original console[method]
 * @param method log, error, etc
 */
export const silenceConsole = (method: string): (() => void) => {
  const consoleT = console as any;
  const originalFunction = consoleT[method];
  consoleT[method] = jest.fn();

  afterAll(() => {
    consoleT[method] = originalFunction;
  });

  return originalFunction;
};
