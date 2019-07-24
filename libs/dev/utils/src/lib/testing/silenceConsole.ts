/**
 * Result of silenceConsole(...)
 */
export interface SilenceConsoleResult {
  /**
   * mocked function, for example mock of console.log
   */
  mock: jest.Mock;
  /**
   * original function, for example console.log
   */
  original(): void;
}

// tslint:disable:no-unsafe-any no-any
/**
 * Silences console[method] for current test and returns original console[method]
 * @param method log, error, etc
 */
export const silenceConsole = (method: string): SilenceConsoleResult => {
  const consoleT = console as any;
  const original = consoleT[method];
  consoleT[method] = jest.fn();
  const mock = consoleT[method] as jest.Mock<string>;

  afterAll(() => {
    consoleT[method] = original;
  });

  return { original, mock };
};
