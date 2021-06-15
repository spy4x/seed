import { Body, Controller, Get, HttpStatus, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';
import {
  API_CONFIG,
  API_KEY_QUERY_SEGMENT_NAME,
  ApiKeyGuard,
  ApiKeyGuardSetTrueValue,
  BaseController,
  IsAuthenticatedGuard,
  NotificationCreateCommand,
  NotificationDTO,
  NotificationsFindMyQuery,
  NotificationsMarkAsReadCommand,
  NotificationsMarkAsReadDTO,
  PaginationResponseDTO,
  UserId,
} from '@seed/back/api/shared';
import { ApiOperation } from '@nestjs/swagger/dist/decorators/api-operation.decorator';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController extends BaseController {
  @Get('/my')
  @UseGuards(IsAuthenticatedGuard)
  @ApiResponse({
    status: HttpStatus.OK,
    type: [NotificationDTO],
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public async findMy(
    @Query() query: NotificationsFindMyQuery,
    @UserId() currentUserId: string,
  ): Promise<PaginationResponseDTO<NotificationDTO>> {
    query.currentUserId = currentUserId;
    return this.logger.trackSegment(this.findMy.name, async () => this.queryBus.execute(query));
  }

  @Patch('/mark-as-read')
  @UseGuards(IsAuthenticatedGuard)
  @ApiResponse({ status: HttpStatus.OK, type: NotificationsMarkAsReadDTO })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public async markAsRead(
    @Body() command: NotificationsMarkAsReadCommand,
    @UserId() currentUserId: string,
  ): Promise<NotificationsMarkAsReadDTO> {
    command.currentUserId = currentUserId;
    return this.logger.trackSegment(this.markAsRead.name, async () => this.commandBus.execute(command));
  }

  @Post('/test')
  @ApiOperation({
    description: `Endpoint for testing Push Notifications.`,
  })
  @UseGuards(IsAuthenticatedGuard)
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public async test(@UserId() currentUserId: string): Promise<void> {
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
