import { CacheModule, Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CqrsModule } from '@nestjs/cqrs';

import { CloudTasksService, FirebaseAdminService, FirebaseAuthService, PrismaService } from './services';
import { ApiKeyGuard, DoesUserExistGuard, IsAuthenticatedGuard } from './nestjs';
import { CloudTaskCreateCommandHandler, CommandBusExt, EventBusExt, QueryBusExt } from './cqrs';
import { CacheTTL } from './cache';

const guards = [ApiKeyGuard, IsAuthenticatedGuard, DoesUserExistGuard];
const services = [
  FirebaseAdminService,
  FirebaseAuthService,
  PrismaService,
  CloudTasksService,
  CommandBusExt,
  QueryBusExt,
  EventBusExt,
];
const commandHandlers = [CloudTaskCreateCommandHandler];
const providers = [...guards, ...services];

const cacheModule = CacheModule.register({ ttl: CacheTTL.week });

@Global()
@Module({
  imports: [CqrsModule, cacheModule, HttpModule],
  providers: [...providers, ...commandHandlers],
  exports: [...providers, CqrsModule, cacheModule, HttpModule],
})
export class SharedModule {}
