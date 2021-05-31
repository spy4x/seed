import * as functions from 'firebase-functions';
import { getApp } from '@seed/back/api/core';
import { UserRecord } from 'firebase-functions/lib/providers/auth';
import { UserGetQuery, LogSegment, LogService, UserDTO } from '@seed/back/api/shared';
import { QueryBus } from '@nestjs/cqrs';

async function handler(logSegment: LogSegment, user: UserRecord): Promise<void> {
  logSegment.log(`userFromFirebase`, user);
  const { nest } = await getApp();
  const queryBus = nest.get(QueryBus);
  const userInDB = await queryBus.execute<UserGetQuery, null | UserDTO>(new UserGetQuery(user.uid));
  logSegment.log(`userInDB`, userInDB || 'not yet created');
}

export const onUserCreate = functions.auth
  .user()
  .onCreate(async user =>
    new LogService(onUserCreate.name).trackSegment<void>(handler.name, async logSegment => handler(logSegment, user)),
  );
