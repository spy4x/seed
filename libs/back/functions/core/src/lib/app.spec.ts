import { NestApp } from './app';

describe('NestApp', () => {
  it('should return a singleton instance', async () => {
    const nestApp = await NestApp.getInstance(true);
    expect(nestApp).toBeDefined();
    expect(nestApp).toBeInstanceOf(NestApp);
    expect(nestApp).toBe(await NestApp.getInstance(true));
  });
  it('should return expressApp & nestApp', async () => {
    const { expressApp, nestApp } = await NestApp.getInstance(true);
    expect(expressApp).toBeDefined();
    expect(nestApp).toBeDefined();
  });
});
