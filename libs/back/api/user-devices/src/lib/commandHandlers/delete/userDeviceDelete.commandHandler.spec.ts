import { Test } from '@nestjs/testing';
import { PrismaService, UserDeviceDeleteCommand } from '@seed/back/api/shared';
import { UserDeviceDeleteCommandHandler } from './userDeviceDelete.commandHandler';
import { mockUserDevices } from '@seed/shared/mock-data';

describe('UserDeviceDeleteCommandHandler', () => {
  const [userDevice] = mockUserDevices;

  const findFirstMock = jest.fn();
  const deleteMock = jest.fn(() => userDevice);

  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    userDevice: {
      findFirst: findFirstMock,
      delete: deleteMock,
    },
  }));

  let userDeviceDeleteCommandHandler: UserDeviceDeleteCommandHandler;

  const command = new UserDeviceDeleteCommand(userDevice.id, '123');

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UserDeviceDeleteCommandHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();

    userDeviceDeleteCommandHandler = moduleRef.get(UserDeviceDeleteCommandHandler);
  });

  describe('execute', () => {
    it('should find existing device by this id and userId, return null if nothing found', async () => {
      findFirstMock.mockReturnValueOnce(null);
      expect(await userDeviceDeleteCommandHandler.execute(command)).toEqual(null);
      expect(findFirstMock).toBeCalledWith({
        where: {
          id: command.id,
          userId: command.currentUserId,
        },
      });
      expect(deleteMock).not.toBeCalled();
    });

    it('should find existing device by this id and userId, and if it is found - delete it and return deleted userDevice', async () => {
      findFirstMock.mockReturnValueOnce(userDevice);
      expect(await userDeviceDeleteCommandHandler.execute(command)).toEqual(userDevice);
      expect(findFirstMock).toBeCalledWith({
        where: {
          id: command.id,
          userId: command.currentUserId,
        },
      });
      expect(deleteMock).toBeCalledWith({
        where: {
          id: command.id,
        },
      });
    });
  });
});
