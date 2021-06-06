import { Test } from '@nestjs/testing';
import { UserDevicesController } from './userDevices.controller';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { SharedModule } from '@seed/back/api/shared';

describe('UserDevicesController', () => {
  let controller: UserDevicesController;
  const queryBusMock = jest.fn();
  const commandBusMock = jest.fn();

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [SharedModule],
      controllers: [UserDevicesController],
      providers: [
        { provide: QueryBus, useClass: queryBusMock },
        { provide: CommandBus, useClass: commandBusMock },
      ],
    }).compile();

    controller = module.get(UserDevicesController);
  });

  it('should be defined', () => {
    expect(controller).toBeTruthy();
  });
});
