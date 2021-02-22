import { Injectable, Scope } from '@nestjs/common';
import { inspect } from 'util';
import * as chalk from 'chalk';
import { format } from 'date-fns';
import { API_CONFIG, Environment } from '../../constants/config.constant';

const isProduction = API_CONFIG.environment === Environment.production;
export enum LogSeverity {
  log = 'log',
  error = 'error',
}
export enum LogContext {
  startSegment = 'startSegment',
  finishSegment = 'finishSegment',
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
    this.logger.write(LogSeverity.log, args, context);
    return this;
  }

  endWithSuccess(params?: Params): this {
    const finish = new Date();
    const durationMs = finish.getTime() - this.startDate.getTime();
    const durationStr = `${durationMs}ms`;
    return this.log(
      `Completed in ${LogService.chalkify(durationStr, chalk.bgWhite.black)}`,
      params,
      LogContext.finishSegment,
    );
  }

  endWithFail(error: Error, params?: Params): this {
    const finish = new Date();
    return this.error({
      message: `Error`,
      error,
      params: { durationMs: finish.getTime() - this.startDate.getTime(), params },
      context: LogContext.finishSegment,
    });
  }
}

type Params = unknown;
enum LogArgType {
  regular = 'regular',
  subCaller = 'subCaller',
  inspect = 'inspect',
}
type LogArg = { type: LogArgType; value: unknown };

@Injectable({ scope: Scope.TRANSIENT })
export class LogService {
  constructor(public caller: string) {}

  static inspect(object: unknown): string {
    return inspect(object, {
      depth: 15, // deep nesting, but avoid infinity for security reasons
      colors: !isProduction, // Google Cloud Logger shows colors as special symbols, like "[32m", instead of coloring text
    });
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

  async trackSegment<R>(name: string, fn: (logSegment: LogSegment) => Promise<R>, params?: Params): Promise<R> {
    const segment = new LogSegment(name, new Date(), this);
    segment.log(`Started`, params, LogContext.startSegment);
    try {
      const result = await fn(segment);
      segment.endWithSuccess();
      return result;
    } catch (error) {
      segment.endWithFail(error);
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

    if (!isProduction) {
      const timestamp = format(new Date(), 'HH:mm:ss.SSS');
      logArgs.push(LogService.chalkify(timestamp, chalk.grey));
    }

    let callerStr = LogService.chalkify(this.caller.padStart(20, ' '), chalk.rgb(180, 150, 100));
    const subCaller = args.find(i => i.type === 'subCaller');
    if (subCaller) {
      callerStr += `>${LogService.chalkify((subCaller.value as string).padEnd(20, ' '), chalk.rgb(150, 125, 210))}`;
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
    console[severity](...logArgs);
    return this;
  }

  static chalkify(str: string, chalkModifier: chalk.Chalk): string {
    if (isProduction) {
      return str;
    }
    return chalkModifier(` ${str} `);
  }

  private static getIcon(severity: LogSeverity, context?: LogContext): string {
    if (severity === LogSeverity.error) {
      return '⛔️';
    }
    if (!context) {
      return '🔷';
    }
    if (context === LogContext.startSegment) {
      return '▶️ ';
    }
    if (context === LogContext.finishSegment) {
      return '✅';
    }
    return '❓';
  }
}
