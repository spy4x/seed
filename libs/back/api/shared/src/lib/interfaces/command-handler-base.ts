import { Injectable } from '@nestjs/common';
import { ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../services/prisma/prisma.service';

@Injectable()
export abstract class CommandHandlerBase<T> implements ICommandHandler<T> {
  constructor(protected readonly prisma: PrismaService) {}

  abstract execute(command: T): Promise<unknown>;
}
