import { INestApplication } from '@nestjs/common/interfaces';
import { UserCreateCommand } from '@seed/back/api/shared';
import { CommandBus } from '@nestjs/cqrs';
import * as faker from 'faker';

export async function actionExample(nestApp: INestApplication): Promise<void> {
  const FIREBASE_AUTH_UID_LENGTH = 28;
  await nestApp
    .get(CommandBus)
    .execute(
      new UserCreateCommand(
        faker.random.alphaNumeric(FIREBASE_AUTH_UID_LENGTH),
        faker.internet.userName(),
        faker.name.firstName(),
        faker.name.lastName(),
        faker.internet.avatar(),
        true,
      ),
    );
}
