import { INestApplication } from '@nestjs/common/interfaces';
import { UsersService } from '@seed/back/api/users';
import { auth } from 'firebase-admin';

export async function actionExample(nestApp: INestApplication): Promise<void> {
  await nestApp.get(UsersService).onCreated(({ test: true } as unknown) as auth.UserRecord);
}
