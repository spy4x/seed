jest.mock('./app.module', () => ({ AppModule: jest.fn() }));
import { Application } from './application.class';

describe(Application.name, () => {
  it('runs application without errors', () => {
    expect(async () => {
      await Application.run();
    }).not.toThrow();
  });
});
