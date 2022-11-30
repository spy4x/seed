import { Test } from '@nestjs/testing';
import { UserDevicesController } from './userDevices.controller';
import { CommandBusExt, QueryBusExt, SharedModule } from '@seed/back/api/shared';

describe(UserDevicesController.name, () => {
  let controller: UserDevicesController;
  const queryBusMock = jest.fn();
  const commandBusMock = jest.fn();

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [SharedModule],
      controllers: [UserDevicesController],
      providers: [
        { provide: QueryBusExt, useClass: queryBusMock },
        { provide: CommandBusExt, useClass: commandBusMock },
      ],
    }).compile();

    controller = module.get(UserDevicesController);
  });

  it('should be defined', () => {
    expect(controller).toBeTruthy();
  });
});
