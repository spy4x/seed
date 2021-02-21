import { Injectable, Scope } from '@nestjs/common';
import { inspect } from 'util';
import { API_CONFIG, Environment } from '../../constants/config.constant';

const isProduction = API_CONFIG.environment === Environment.production;

export class LogSegment {
  constructor(public readonly name: string, public readonly startDate: Date, private readonly logger: LogService) {}

  endWithSuccess(params?: Params): this {
    const finish = new Date();
    return this.log(`✅ Done`, { durationMs: finish.getTime() - this.startDate.getTime(), params });
  }

  endWithFail(error: Error, params?: Params): this {
    const finish = new Date();
    return this.error({
      message: `⛔️ Error`,
      error,
      params: { durationMs: finish.getTime() - this.startDate.getTime(), params },
    });
  }

  log(message?: string, params?: Params): this {
    const args: LogArg[] = [];
    args.push({ type: LogArgType.regular, value: `[${this.name}]` });
    if (message) {
      args.push({ type: LogArgType.regular, value: message });
    }
    if (params) {
      args.push({ type: LogArgType.inspect, value: params });
    }
    this.logger.write('log', args);
    return this;
  }

  error({ message, error, params }: { message?: string; error?: Error; params?: Params }): this {
    const args: LogArg[] = [];
    args.push({ type: LogArgType.regular, value: `[${this.name}]` });
    if (message) {
      args.push({ type: LogArgType.regular, value: message });
    }
    if (error) {
      args.push({ type: LogArgType.regular, value: error });
    }
    if (params) {
      args.push({ type: LogArgType.inspect, value: params });
    }
    this.logger.write('log', args);
    return this;
  }
}

type Params = unknown;
enum LogArgType {
  regular = 'regular',
  inspect = 'inspect',
}
type LogArg = { type: LogArgType; value: unknown };

@Injectable({ scope: Scope.TRANSIENT })
export class LogService {
  private caller = '';

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
    segment.log(`▶️ Starting`, params);
    return segment;
  }

  log(message?: string, params?: Params): this {
    const args: LogArg[] = [];
    if (message) {
      args.push({ type: LogArgType.regular, value: message });
    }
    if (params) {
      args.push({ type: LogArgType.inspect, value: params });
    }
    return this.write('log', args);
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
    return this.write('error', args);
  }

  write(severity: 'log' | 'error', args: LogArg[]): this {
    let logArgs: unknown[] = [];
    const functionName = process.env.FUNCTION_NAME;
    if (!isProduction && functionName) {
      const timestamp = new Date().toISOString();
      logArgs.push(`[${timestamp}]` + (functionName ? `[${functionName}]` : ''));
    }
    if (this.caller) {
      logArgs.push(this.caller);
    }
    logArgs = [
      ...logArgs,
      ...args.map(arg => {
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
}
