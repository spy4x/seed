import { Module } from '@nestjs/common';
import { ApiKeyGuard } from './guards/apiKey/apiKey.guard';
import { IsAuthenticatedGuard } from './guards/isAuthenticated/isAuthenticated.guard';
import { FirebaseAuthService } from './services/firebaseAuth/firebaseAuth.service';
import { LogService } from './services/log/log.service';

const providers = [ApiKeyGuard, IsAuthenticatedGuard, FirebaseAuthService, LogService];
@Module({
  providers,
  exports: providers,
})
export class SharedModule {}
