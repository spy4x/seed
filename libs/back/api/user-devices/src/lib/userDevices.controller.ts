import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  BaseController,
  DoesUserExistGuard,
  NotFoundInterceptor,
  PaginationResponseDTO,
  UserDeviceCreateCommand,
  UserDeviceDeleteCommand,
  UserDeviceDTO,
  UserDevicesFindMyQuery,
  UserDeviceUpdateCommand,
  UserId,
} from '@seed/back/api/shared';

@ApiTags('user-devices')
@ApiBearerAuth()
@Controller('user-devices')
export class UserDevicesController extends BaseController {
  @Get('/my')
  @UseGuards(DoesUserExistGuard)
  @ApiResponse({
    status: HttpStatus.OK,
    type: [UserDeviceDTO],
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public async findMy(
    @Query() query: UserDevicesFindMyQuery,
    @UserId() currentUserId: string,
  ): Promise<PaginationResponseDTO<UserDeviceDTO>> {
    query.currentUserId = currentUserId;
    return this.logger.trackSegment(this.findMy.name, async () => this.queryBus.execute(query));
  }

  @Post()
  @UseGuards(DoesUserExistGuard)
  @ApiResponse({ status: HttpStatus.CREATED, type: UserDeviceDTO })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  @ApiResponse({ status: HttpStatus.CONFLICT })
  public async create(
    @Body() command: UserDeviceCreateCommand,
    @UserId() currentUserId: string,
  ): Promise<UserDeviceDTO> {
    command.userId = currentUserId;
    return this.logger.trackSegment(this.create.name, async () => this.commandBus.execute(command));
  }

  @Patch(':id')
  @UseGuards(DoesUserExistGuard)
  @UseInterceptors(NotFoundInterceptor)
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: HttpStatus.OK, type: UserDeviceDTO })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  public async update(
    @Body() command: UserDeviceUpdateCommand,
    @UserId() currentUserId: string,
    @Param('id') id: string,
  ): Promise<UserDeviceDTO> {
    command.id = id;
    command.currentUserId = currentUserId;
    const updatedUserDevice = await this.logger.trackSegment(this.update.name, async () =>
      this.commandBus.execute<null | UserDeviceDTO>(command),
    );
    if (!updatedUserDevice) {
      throw new NotFoundException(`UserDevice with id ${id} and owner userId ${currentUserId} doesn't exist.`);
    }
    return updatedUserDevice;
  }

  @Delete(':id')
  @UseGuards(DoesUserExistGuard)
  @UseInterceptors(NotFoundInterceptor)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, type: UserDeviceDTO })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  public async delete(
    @Body() command: UserDeviceDeleteCommand,
    @Param('id') id: string,
    @UserId() currentUserId: string,
  ): Promise<UserDeviceDTO> {
    command.id = id;
    command.currentUserId = currentUserId;
    const deletedUserDevice = await this.logger.trackSegment(this.delete.name, async () =>
      this.commandBus.execute<null | UserDeviceDTO>(command),
    );
    if (!deletedUserDevice) {
      throw new NotFoundException(`UserDevice with {id: ${id}, userId: ${currentUserId}} doesn't exist.`);
    }
    return deletedUserDevice;
  }
}
