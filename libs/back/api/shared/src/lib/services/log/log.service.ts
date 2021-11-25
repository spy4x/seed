import { inspect as utilInspect } from 'util';
import * as chalk from 'chalk';
import { format } from 'date-fns';
import { isEnv } from '../../constants';
import { Environment } from '@seed/shared/types';

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

enum LogArgType {
  regular = 'regular',
  subCaller = 'subCaller',
  inspect = 'inspect',
}

interface LogArg {
  type: LogArgType;
  value: unknown;
}

const IS_PRODUCTION = isEnv(Environment.production);

export function chalkify(str: string, chalkModifier: chalk.Chalk): string {
  if (IS_PRODUCTION) {
    return str;
  }
  return chalkModifier(` ${str} `);
}

export class LogSegment {
  constructor(public caller: string, public startDate: Date, private readonly logger: LogService) {}

  log(message: string, params?: Params, context?: LogContext): this {
    const args: LogArg[] = [];
    args.push({ type: LogArgType.subCaller, value: this.caller });
    args.push({ type: LogArgType.regular, value: message });
    if (params) {
      args.push({ type: LogArgType.inspect, value: params });
    }
    this.logger.write(LogSeverity.log, args, context);
    return this;
  }

  warn(message: string, params?: Params, context?: LogContext): this {
    const args: LogArg[] = [];
    args.push({ type: LogArgType.subCaller, value: this.caller });
    args.push({ type: LogArgType.regular, value: message });
    if (params) {
      args.push({ type: LogArgType.inspect, value: params });
    }
    this.logger.write(LogSeverity.warn, args, context);
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
    const args: LogArg[] = [];
    args.push({ type: LogArgType.subCaller, value: this.caller });
    if (message) {
      args.push({ type: LogArgType.regular, value: message });
    }
    if (error) {
      args.push({ type: LogArgType.regular, value: error });
    }
    if (params) {
      args.push({ type: LogArgType.inspect, value: params });
    }
    this.logger.write(LogSeverity.error, args, context);
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

  setCaller(caller: string): this {
    this.caller = caller;
    return this;
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

  log(message?: string, params?: Params): this {
    const args: LogArg[] = [];
    if (message) {
      args.push({ type: LogArgType.regular, value: message });
    }
    if (params) {
      args.push({ type: LogArgType.inspect, value: params });
    }
    return this.write(LogSeverity.log, args);
  }

  warn(message?: string, params?: Params): this {
    const args: LogArg[] = [];
    if (message) {
      args.push({ type: LogArgType.regular, value: message });
    }
    if (params) {
      args.push({ type: LogArgType.inspect, value: params });
    }
    return this.write(LogSeverity.warn, args);
  }

  error({ message, error, params }: { message?: string; error?: Error; params?: Params }): this {
    const args: LogArg[] = [];
    if (message) {
      args.push({ type: LogArgType.regular, value: message });
    }
    if (error) {
      args.push({ type: LogArgType.regular, value: error });
    }
    if (params) {
      args.push({ type: LogArgType.inspect, value: params });
    }
    return this.write(LogSeverity.error, args);
  }

  write(severity: LogSeverity, args: LogArg[], context?: LogContext): this {
    let logArgs: unknown[] = [];

    if (!IS_PRODUCTION) {
      const timestamp = format(new Date(), 'HH:mm:ss.SSS');
      logArgs.push(chalkify(timestamp, chalk.grey));
    }

    const maxLength = 20;
    const brown = { r: 180, g: 150, b: 100 };
    const purple = { r: 150, g: 125, b: 210 };
    const spaceCharacter = IS_PRODUCTION ? '_' : ' ';
    let callerStr = chalkify(this.caller.padStart(maxLength, spaceCharacter), chalk.rgb(brown.r, brown.g, brown.b));
    const subCaller = args.find(i => i.type === 'subCaller');
    if (subCaller) {
      callerStr += ` > ${chalkify(
        (subCaller.value as string).padEnd(maxLength, spaceCharacter),
        chalk.rgb(purple.r, purple.g, purple.b),
      )}`;
    }
    logArgs.push(callerStr);

    logArgs.push(LogService.getIcon(severity, context));

    logArgs = [
      ...logArgs,
      ...args
        .filter(i => i.type !== 'subCaller')
        .map(arg => {
          switch (arg.type) {
            case 'regular':
              return arg.value;
            case 'inspect':
              return LogService.inspect(arg.value);
            default:
              throw new Error(`LogService.write(): Unknown argument type ${arg.type}`);
          }
        }),
    ];

    // eslint-disable-next-line no-console
    console[severity](...logArgs);
    return this;
  }
}
