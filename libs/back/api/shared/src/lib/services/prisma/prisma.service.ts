/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-implicit-any-catch */
/* eslint-disable @typescript-eslint/promise-function-async */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/consistent-type-definitions */
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { ONE } from '@seed/shared/constants';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MIN_BACKOFF = 5;
const DEFAILT_MAX_BACKOFF = 30;

type BackoffOptions = {
  min?: number;
  max?: number;
};

type RetryOptions = {
  maxRetries?: number;
  backoff?: boolean | BackoffOptions;
};

const sleep = (min: number, max: number) => {
  const ms = Math.floor(Math.random() * (max - min + ONE) + min);
  // eslint-disable-next-line no-promise-executor-return
  return new Promise(resolve => setTimeout(resolve, ms));
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

  return async (params, next) => {
    let retries = 0;
    do {
      try {
        const result = await next(params);
        return result;
      } catch (err) {
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
    super({ log: ['query', 'info', `warn`, `error`] });
  }

  async onModuleInit(): Promise<void> {
    this.$use(retry());

    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
