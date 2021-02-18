import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import * as Sentry from '@sentry/node';

@Injectable()
export class LoggerInterceptor implements NestInterceptor {
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError(event => {
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
