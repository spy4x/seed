import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ONE } from '@seed/shared/constants';
import { isEnv } from '../../constants';
import { Environment } from '@seed/shared/types';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MIN_BACKOFF = 5;
const DEFAILT_MAX_BACKOFF = 30;

interface BackoffOptions {
  min?: number;
  max?: number;
}

interface RetryOptions {
  maxRetries?: number;
  backoff?: boolean | BackoffOptions;
}

const sleep = async (min: number, max: number): Promise<void> => {
  const ms = Math.floor(Math.random() * (max - min + ONE) + min);
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
};

export class PrismaRetryError extends Error {
  constructor() {
    super();
    this.name = 'PrismaRetryError';
  }
}

export const retry = (options?: RetryOptions): Prisma.Middleware => {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoff = options?.backoff ?? true;
  const minBackoff = (options?.backoff as BackoffOptions | undefined)?.min ?? DEFAULT_MIN_BACKOFF;
  const maxBackoff = (options?.backoff as BackoffOptions | undefined)?.max ?? DEFAILT_MAX_BACKOFF;
  if (minBackoff > maxBackoff) {
    throw new Error('Minimum backoff must be less than maximum backoff');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (params, next): Promise<any> => {
    let retries = 0;
    do {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return await next(params);
      } catch (err: unknown) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P1017') {
          retries += ONE;
          if (backoff) {
            await sleep(minBackoff, maxBackoff);
          }
          continue;
        }
        throw err;
      }
    } while (retries < maxRetries);
    throw new PrismaRetryError();
  };
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ log: ['info', `warn`, `error`, ...(isEnv(Environment.production) ? [] : (['query'] as 'query'[]))] });
  }

  async onModuleInit(): Promise<void> {
    this.$use(retry());

    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
