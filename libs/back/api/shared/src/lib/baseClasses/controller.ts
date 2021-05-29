import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { LogService } from '../services';

@Injectable()
export class BaseController {
  protected readonly logger = new LogService(this.constructor.name);

  constructor(protected readonly commandBus: CommandBus, protected readonly queryBus: QueryBus) {}
}
