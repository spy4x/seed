import { Body, Controller, Get, HttpStatus, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';
import {
  API_CONFIG,
  API_KEY_QUERY_SEGMENT_NAME,
  ApiKeyGuard,
  ApiKeyGuardSetTrueValue,
  BaseController,
  DoesUserExistGuard,
  NotificationCreateCommand,
  NotificationDTO,
  NotificationsFindMyQuery,
  NotificationsMarkAsReadCommand,
  NotificationsMarkAsReadDTO,
  PaginationResponseDTO,
  ReqUserId,
} from '@seed/back/api/shared';
import { ApiOperation } from '@nestjs/swagger/dist/decorators/api-operation.decorator';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController extends BaseController {
  @Get('/my')
  @UseGuards(DoesUserExistGuard)
  @ApiResponse({
    status: HttpStatus.OK,
    type: [NotificationDTO],
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public async findMy(
    @Query() query: NotificationsFindMyQuery,
    @ReqUserId() currentUserId: string,
  ): Promise<PaginationResponseDTO<NotificationDTO>> {
    query.currentUserId = currentUserId;
    return this.logger.trackSegment(this.findMy.name, async () => this.queryBus.execute(query));
  }

  @Patch('/mark-as-read')
  @UseGuards(DoesUserExistGuard)
  @ApiResponse({ status: HttpStatus.OK, type: NotificationsMarkAsReadDTO })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public async markAsRead(
    @Body() command: NotificationsMarkAsReadCommand,
    @ReqUserId() currentUserId: string,
  ): Promise<NotificationsMarkAsReadDTO> {
    command.currentUserId = currentUserId;
    return this.logger.trackSegment(this.markAsRead.name, async () => this.commandBus.execute(command));
  }

  @Post('/test')
  @ApiOperation({
    description: `Endpoint for testing Push Notifications.`,
  })
  @UseGuards(DoesUserExistGuard)
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public async test(@ReqUserId() currentUserId: string): Promise<void> {
    return this.logger.trackSegment(this.test.name, async () =>
      this.commandBus.execute(new NotificationCreateCommand(currentUserId, NotificationType.TEST)),
    );
  }

  @Post('/invoke')
  @UseGuards(ApiKeyGuard)
  @ApiKeyGuardSetTrueValue(API_CONFIG.apiKeys.cloudTasks)
  @ApiOperation({
    description: `Endpoint for Cloud Tasks.`,
  })
  @ApiQuery({
    name: API_KEY_QUERY_SEGMENT_NAME,
    type: String,
  })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public async invoke(@Body() command: NotificationCreateCommand): Promise<void> {
    return this.logger.trackSegment(this.invoke.name, async () => this.commandBus.execute(command));
  }
}
