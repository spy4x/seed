import { Logger, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  DefaultHeadersInterceptor,
  LoggerInterceptor,
  SharedModule,
  UserIdMiddleware,
  UserMiddleware,
} from '@seed/back/api/shared';
import { UsersModule } from '@seed/back/api/users';
import { UserDevicesModule } from '@seed/back/api/user-devices';
import { NotificationsModule } from '@seed/back/api/notifications';
import { CoreController } from './core.controller';

Logger.overrideLogger(['warn', 'error']); // for DEBUG: replace with ['warn','error','debug','log','verbose']

const systemModules = [SharedModule];
const featureModules = [UsersModule, UserDevicesModule, NotificationsModule];

@Module({
  imports: [...systemModules, ...featureModules],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggerInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: DefaultHeadersInterceptor,
    },
  ],
  controllers: [CoreController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): MiddlewareConsumer {
    return consumer.apply(UserIdMiddleware).forRoutes('*').apply(UserMiddleware).forRoutes('*');
  }
}
