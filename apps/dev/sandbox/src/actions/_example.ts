import { INestApplication } from '@nestjs/common/interfaces';
import { UsersController } from '@seed/back/api/users';
import { FindUsersQuery } from '@seed/back/api/shared';

export async function actionExample(nestApp: INestApplication): Promise<void> {
  const page = 1;
  const limit = 3;
  await nestApp.get(UsersController).find(new FindUsersQuery(page, limit), '');
}
