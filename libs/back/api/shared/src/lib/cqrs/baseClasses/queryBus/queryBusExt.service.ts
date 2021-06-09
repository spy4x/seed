import { QueryBus, IQuery } from '@nestjs/cqrs';
import { LogService } from '../../../services';
import { Injectable } from '@nestjs/common';

@Injectable()
export class QueryBusExt {
  readonly logger = new LogService('QueryBus');

  constructor(public queryBus: QueryBus) {}

  async execute<R>(query: IQuery): Promise<R> {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-assignment */
    const queryName = Object.getPrototypeOf(query)?.constructor?.name;
    return this.logger.trackSegment<R>(
      queryName || 'UnknownQuery',
      async () => {
        return this.queryBus.execute(query);
      },
      queryName ? { ...query } : query,
    );
  }
}
