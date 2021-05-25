import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { LogService } from '../services';

@Injectable()
export class Controller {
  protected readonly _logger = new LogService(this.constructor.name);
  constructor(protected readonly _commandBus: CommandBus, protected readonly _queryBus: QueryBus) {}
}
