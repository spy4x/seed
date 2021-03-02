import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import * as Sentry from '@sentry/node';

@Injectable()
export class LoggerInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((event: Error & { status?: number }) => {
        if (!event.status) {
          // error wasn't handled before
          Sentry.captureException(event);
        }
        // Next line with "throw event" does:
        // if error was handled (has HTTP status, like 400) - sends response as it is (like ValidationError details)
        // if error wasn't handled (has no HTTP status) - sends status 500, Internal Server Error
        throw event;
      }),
    );
  }
}
