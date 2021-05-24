import { Injectable, NestInterceptor, ExecutionContext, NotFoundException, CallHandler } from '@nestjs/common';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';

@Injectable()
export class NotFoundInterceptor implements NestInterceptor {
  intercept(_: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap(data => {
        if (!data) {
          throw new NotFoundException();
        }
      }),
    );
  }
}
