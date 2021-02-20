import { INestApplication } from '@nestjs/common/interfaces';
import { getApp } from '@seed/back/functions/core';
import { LogService } from '@seed/back/functions/shared';

export async function scriptWrapper(fn: (nest: INestApplication) => Promise<void>) {
  const logSegment = new LogService().startSegment(fn.name || 'Anonymous function');
  try {
    const { nest } = await getApp();
    await fn(nest);
    logSegment.endWithSuccess();
  } catch (error) {
    logSegment.endWithFail(error);
  }
}
