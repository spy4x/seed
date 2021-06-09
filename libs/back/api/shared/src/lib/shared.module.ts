import { Global, Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CloudTasksService, FirebaseAuthService, PrismaService } from './services';
import { ApiKeyGuard, IsAuthenticatedGuard } from './nestjs';
import { CommandBusExt, QueryBusExt, EventBusExt, CloudTaskCreateCommandHandler } from './cqrs';

const guards = [ApiKeyGuard, IsAuthenticatedGuard];
const services = [FirebaseAuthService, PrismaService, CloudTasksService, CommandBusExt, QueryBusExt, EventBusExt];
const commandHandlers = [CloudTaskCreateCommandHandler];

const providers = [...guards, ...services];

@Global()
@Module({
  imports: [CqrsModule],
  providers: [...providers, ...commandHandlers],
  exports: [...providers],
})
export class SharedModule {}
