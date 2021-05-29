jest.mock('./app.module', () => ({ AppModule: jest.fn() }));
import { getApp } from './app';

describe('NestApp', () => {
  it('should return a singleton instance', async () => {
    const nestApp = await getApp();
    expect(nestApp).toBeDefined();
    expect(nestApp).toBe(await getApp());
  });
  it('should return expressApp & nestApp', async () => {
    const { express, nest } = await getApp();
    expect(express).toBeDefined();
    expect(nest).toBeDefined();
  });
});
