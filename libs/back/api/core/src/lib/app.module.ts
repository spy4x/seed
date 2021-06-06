import { Logger, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SharedModule, UserMiddleware } from '@seed/back/api/shared';
import { UsersModule } from '@seed/back/api/users';
import { UserDevicesModule } from '@seed/back/api/user-devices';
import { CoreController } from './core.controller';
import { LoggerInterceptor } from './interceptors/logger/logger.interceptor';

Logger.overrideLogger(['warn', 'error']); // for DEBUG: replace with ['warn','error','debug','log','verbose']

const systemModules = [SharedModule];
const featureModules = [UsersModule, UserDevicesModule];

@Module({
  imports: [...systemModules, ...featureModules],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggerInterceptor,
    },
  ],
  controllers: [CoreController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): MiddlewareConsumer {
    return consumer.apply(UserMiddleware).forRoutes('*');
  }
}
