import { CommandBus, ICommand } from '@nestjs/cqrs';
import { LogService } from '../../../services';
import { Injectable } from '@nestjs/common';

@Injectable()
export class CommandBusExt {
  readonly logger = new LogService('CommandBus');

  constructor(public commandBus: CommandBus) {}

  async execute<R>(command: ICommand): Promise<R> {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-assignment */
    const commandName = Object.getPrototypeOf(command)?.constructor?.name;
    return this.logger.trackSegment<R>(
      commandName || 'UnknownCommand',
      async () => {
        return this.commandBus.execute(command);
      },
      commandName ? { ...command } : command,
    );
  }
}
