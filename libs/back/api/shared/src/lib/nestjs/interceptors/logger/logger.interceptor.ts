import { CallHandler, ExecutionContext, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import * as Sentry from '@sentry/node';
import { LogService } from '../../../services';

@Injectable()
export class LoggerInterceptor implements NestInterceptor {
  private readonly _logger = new LogService(LoggerInterceptor.name);

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: Error & { status?: number }) => {
        if (!error.status || error.status === HttpStatus.INTERNAL_SERVER_ERROR) {
          // error wasn't handled before
          this._logger.error({ message: `Unhandled Exception`, error });

          Sentry.captureException(error);
        }
        // Next line with "throw error" does:
        // if error was handled (has HTTP status, like 400) - sends response as it is (like ValidationError details)
        // if error wasn't handled (has no HTTP status) - sends status 500, Internal Server Error
        throw error;
      }),
    );
  }
}
