import { INestApplication } from '@nestjs/common/interfaces';
import { getApp } from '@seed/back/api/core';
import { LogService } from '@seed/back/api/shared';

export async function scriptWrapper(fn: (nest: INestApplication) => Promise<void>): Promise<void> {
  const executeFn = async (): Promise<void> => {
    const { nest } = await getApp();
    await fn(nest);
  };
  return new LogService(scriptWrapper.name).trackSegment<void>(fn.name || 'Anonymous function', executeFn);
}
