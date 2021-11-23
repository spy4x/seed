import { CacheModule, CacheStoreFactory, Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CqrsModule } from '@nestjs/cqrs';
import * as redisStore from 'cache-manager-redis-store';

import { CloudTasksService, FirebaseAuthService, PrismaService } from './services';
import { ApiKeyGuard, DoesUserExistGuard, IsAuthenticatedGuard } from './nestjs';
import { CloudTaskCreateCommandHandler, CommandBusExt, EventBusExt, QueryBusExt } from './cqrs';
import { API_CONFIG, CacheTTL } from './constants';

const guards = [ApiKeyGuard, IsAuthenticatedGuard, DoesUserExistGuard];
const services = [FirebaseAuthService, PrismaService, CloudTasksService, CommandBusExt, QueryBusExt, EventBusExt];
const commandHandlers = [CloudTaskCreateCommandHandler];
const providers = [...guards, ...services];

const cacheModule = CacheModule.register({
  store: redisStore as unknown as CacheStoreFactory,
  port: 6379,
  host: API_CONFIG.redisHost,
  ttl: CacheTTL.week,
});

@Global()
@Module({
  imports: [CqrsModule, cacheModule, HttpModule],
  providers: [...providers, ...commandHandlers],
  exports: [...providers, CqrsModule, cacheModule, HttpModule],
})
export class SharedModule {}
