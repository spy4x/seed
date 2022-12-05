import { inspect as utilInspect } from 'util';
import * as chalk from 'chalk';
import { format } from 'date-fns';
import { isEnv } from '../../constants';
import { Environment } from '@seed/shared/types';
import { LoggingWinston } from '@google-cloud/logging-winston';
import * as winston from 'winston';

export enum LogSeverity {
  log = 'log',
  warn = 'warn',
  error = 'error',
}

export enum LogContext {
  startSegment = 'startSegment',
  finishSegment = 'finishSegment',
}

type Params = unknown;

const IS_PRODUCTION = isEnv(Environment.production);

const loggingWinston = new LoggingWinston();

// Create a Winston logger that streams to Cloud Logging
// Logs will be written to: "projects/YOUR_PROJECT_ID/logs/winston_log"
const logger = winston.createLogger({
  level: 'info',
  transports: [
    IS_PRODUCTION
      ? loggingWinston
      : new winston.transports.Console({
          format: winston.format.simple(),
        }),
  ],
});

export function chalkify(str: string, chalkModifier: chalk.Chalk): string {
  if (IS_PRODUCTION) {
    return str;
  }
  return chalkModifier(` ${str} `);
}

export class LogSegment {
  constructor(public caller: string, public startDate: Date, private readonly logger: LogService) {}

  log(message: string, params?: Params, context?: LogContext): this {
    this.logger.write(LogSeverity.log, message, params, this.caller, context);
    return this;
  }

  error({
    message,
    error,
    params,
    context,
  }: {
    message?: string;
    error?: Error;
    params?: Params;
    context?: LogContext;
  }): this {
    this.logger.write(
      LogSeverity.error,
      (message || error?.message) as string,
      { ...(params || {}), error },
      this.caller,
      context,
    );
    return this;
  }

  endWithSuccess(params?: Params): this {
    const finish = new Date();
    const durationMs = finish.getTime() - this.startDate.getTime();
    const durationStr = `${durationMs}ms`;
    return this.log(`Completed in ${chalkify(durationStr, chalk.bgWhite.black)}`, params, LogContext.finishSegment);
  }

  endWithFail(error: Error, params?: Params): this {
    const finish = new Date();
    const durationMs = finish.getTime() - this.startDate.getTime();
    const paramsObj: { durationMs: number; params?: Params } = { durationMs };
    if (params) {
      paramsObj.params = params;
    }
    return this.error({
      message: `Error`,
      error,
      params: paramsObj,
      context: LogContext.finishSegment,
    });
  }
}

export class LogService {
  constructor(public caller: string) {}

  public static inspect(object: unknown): string {
    const MAX_LINE_WIDTH = 120;
    return utilInspect(object, {
      depth: 15, // deep nesting, but avoid infinity for security reasons
      colors: !IS_PRODUCTION, // Google Cloud Logger shows colors as special symbols, like "[32m", instead of coloring text
      breakLength: IS_PRODUCTION ? Infinity : MAX_LINE_WIDTH,
    });
  }

  public static getIcon(severity: LogSeverity, context?: LogContext): string {
    if (severity === LogSeverity.error) {
      return '⛔️';
    }
    if (severity === LogSeverity.warn) {
      return '⚠️ ';
    }
    switch (context) {
      case LogContext.startSegment:
        return '▶️ ';
      case LogContext.finishSegment:
        return '✅';
      case undefined:
        return '🔷';
    }
    return '❓';
  }

  startSegment(name: string, params?: Params): LogSegment {
    const segment = new LogSegment(name, new Date(), this);
    segment.log(`Started`, params, LogContext.startSegment);
    return segment;
  }

  async trackSegment<R>(
    name: string,
    fn: (logSegment: LogSegment) => Promise<R>,
    params?: Params,
    shouldLogResult?: boolean,
  ): Promise<R> {
    const segment = new LogSegment(name, new Date(), this);
    segment.log(`Started`, params, LogContext.startSegment);
    try {
      const result = await fn(segment);
      if (shouldLogResult) {
        segment.endWithSuccess(result);
      } else {
        segment.endWithSuccess();
      }
      return result;
    } catch (error: unknown) {
      if (error instanceof Error) {
        segment.endWithFail(error);
      }
      throw error;
    }
  }

  trackSegmentSync<R>(name: string, fn: (logSegment: LogSegment) => R, params?: Params, shouldLogResult?: boolean): R {
    const segment = new LogSegment(name, new Date(), this);
    segment.log(`Started`, params, LogContext.startSegment);
    try {
      const result = fn(segment);
      if (shouldLogResult) {
        segment.endWithSuccess(result);
      } else {
        segment.endWithSuccess();
      }
      return result;
    } catch (error: unknown) {
      if (error instanceof Error) {
        segment.endWithFail(error);
      }
      throw error;
    }
  }

  log(message: string, params?: Params): this {
    return this.write(LogSeverity.log, message, params);
  }

  error({ message, error, params }: { message?: string; error?: Error; params?: Params }): this {
    return this.write(LogSeverity.error, (message || error?.message) as string, { ...(params || {}), error });
  }

  write(severity: LogSeverity, message: string, data?: Params, subCaller?: string, context?: LogContext): this {
    const maxLength = 20;
    const brown = { r: 180, g: 150, b: 100 };
    const purple = { r: 150, g: 125, b: 210 };
    const spaceCharacter = IS_PRODUCTION ? '_' : ' ';
    let callerStr = chalkify(this.caller.padStart(maxLength, spaceCharacter), chalk.rgb(brown.r, brown.g, brown.b));
    if (subCaller) {
      callerStr += ` > ${chalkify(
        subCaller.padEnd(maxLength, spaceCharacter),
        chalk.rgb(purple.r, purple.g, purple.b),
      )}`;
    }

    const timestamp = IS_PRODUCTION ? '' : chalkify(format(new Date(), 'HH:mm:ss.SSS'), chalk.grey) + ' ';
    message =
      timestamp +
      callerStr +
      ' ' +
      LogService.getIcon(severity, context) +
      '  ' +
      message +
      (data ? ` ${LogService.inspect(data)}` : '');

    logger[severity](message, data);
    return this;
  }
}
