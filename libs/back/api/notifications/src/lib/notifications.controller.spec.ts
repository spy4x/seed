import { Test } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { CommandBusExt, QueryBusExt } from '@seed/back/api/shared';

describe(NotificationsController.name, () => {
  let controller: NotificationsController;
  const queryBusMock = jest.fn();
  const commandBusMock = jest.fn();

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: QueryBusExt, useClass: queryBusMock },
        { provide: CommandBusExt, useClass: commandBusMock },
      ],
    }).compile();

    controller = module.get(NotificationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeTruthy();
  });
});
