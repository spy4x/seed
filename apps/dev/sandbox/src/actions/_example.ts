import { INestApplication } from '@nestjs/common/interfaces';
import { UsersService } from '@seed/back/functions/users';
import { admin } from 'firebase-admin/lib/auth';

export async function actionExample(nestApp: INestApplication): Promise<void> {
  await nestApp.get(UsersService).log(({ test: true } as unknown) as admin.auth.UserRecord);
}
