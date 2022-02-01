import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { Response } from 'express';
import { catchError, map } from 'rxjs/operators';
import { ONE, ZERO } from '@seed/shared/constants';
import { LogService } from '../../../services';

const DEFAULT_HEADERS_MAP = {
  'Cache-Control': 'no-store',
};

@Injectable()
export class DefaultHeadersInterceptor implements NestInterceptor {
  logService = new LogService(DefaultHeadersInterceptor.name);

  private static applyDefaultHeaders(context: ExecutionContext): void {
    const res: Response = context.switchToHttp().getResponse();
    for (const header of Object.entries(DEFAULT_HEADERS_MAP)) {
      const headerName = header[ZERO];
      const headerDefaultValue = header[ONE];
      const customValue = res.getHeader(headerName);
      if (!customValue) {
        res.setHeader(headerName, headerDefaultValue);
      }
    }
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value: unknown) => {
        // we use "map()" instead of "tap()" here to make sure response "waits" for our logic to complete
        DefaultHeadersInterceptor.applyDefaultHeaders(context);
        return value; // value is not modified
      }),
      catchError((error: unknown) => {
        DefaultHeadersInterceptor.applyDefaultHeaders(context);
        return throwError(error);
      }),
    );
  }
}
