import { Injectable } from '@nestjs/common';
import { LogService } from '../../services';
import { CommandBusExt, QueryBusExt } from '../../cqrs';

@Injectable()
export class BaseController {
  readonly logger = new LogService(this.constructor.name);

  constructor(readonly commandBus: CommandBusExt, readonly queryBus: QueryBusExt) {}
}
