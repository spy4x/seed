import { Logger, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { UsersModule } from '@seed/back/api/users';
import { LoggerInterceptor } from './interceptors/logger/logger.interceptor';

Logger.overrideLogger(['warn', 'error']); // for DEBUG: replace with ['warn','error','debug','log','verbose']

@Module({
  imports: [UsersModule],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggerInterceptor,
    },
  ],
})
export class AppModule {}
