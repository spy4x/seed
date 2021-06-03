import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { LogService } from '../services';

@Injectable()
export class BaseController {
  readonly logger = new LogService(this.constructor.name);

  constructor(readonly commandBus: CommandBus, readonly queryBus: QueryBus) {}
}
