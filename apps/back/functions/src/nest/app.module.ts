import { Module } from '@nestjs/common';
import { UsersModule } from '@afs/back/functions/users';

@Module({
  imports: [UsersModule],
})
export class AppModule {}
