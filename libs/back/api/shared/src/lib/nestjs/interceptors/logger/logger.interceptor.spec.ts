import { LoggerInterceptor } from './logger.interceptor';
import { throwError } from 'rxjs';
import * as Sentry from '@sentry/node';

describe('LoggerInterceptor', () => {
  const loggerInterceptor = new LoggerInterceptor();

  const contextMock = jest.fn().mockImplementation(() => ({
    switchToHttp: () => ({
      getRequest: () => null,
    }),
  }));
  const status: { status?: string } = { status: 'test' };
  const nextMock = jest.fn().mockImplementation(() => {
    return {
      handle: () => {
        return throwError(status);
      },
    };
  });
  beforeEach(() => {
    nextMock.mockImplementation(() => {
      return {
        handle: () => {
          return throwError(status);
        },
      };
    });
  });

  it('should throw error with provided status', done => {
    loggerInterceptor.intercept(new contextMock(), new nextMock()).subscribe(null, error => {
      expect(error.status).toEqual(status.status);
      done();
    });
  });
  it('should throw error without status', done => {
    delete status.status;

    loggerInterceptor.intercept(new contextMock(), new nextMock()).subscribe(null, error => {
      expect(error.status).toBeUndefined();
      done();
    });
  });
  it('should call Sentry.captureException when error without status was thrown', async () => {
    jest.mock('@sentry/node', () => {
      return {
        captureException: jest.fn(),
      };
    });
    const sentrySpy = jest.spyOn(Sentry, 'captureException');
    try {
      await loggerInterceptor.intercept(new contextMock(), new nextMock()).toPromise();
    } catch {
      expect(sentrySpy).toBeCalled();
    }
  });
});
