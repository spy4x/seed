import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  BaseController,
  Cache,
  CacheAccess,
  CacheTTL,
  DoesUserExistGuard,
  IsAuthenticatedGuard,
  NotFoundInterceptor,
  PaginationResponseDTO,
  UserCreateCommand,
  UserDeleteCommand,
  UserDTO,
  UserGetQuery,
  ReqUserId,
  UserIsUsernameFreeDTO,
  UserIsUsernameFreeQuery,
  UsersFindQuery,
  UserUpdateCommand,
  UserUpdateLastSignedInCommand,
  ReqUser,
} from '@seed/back/api/shared';
import { ApiBearerAuth, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { User } from '@prisma/client';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController extends BaseController {
  @Get()
  @UseGuards(IsAuthenticatedGuard)
  @ApiResponse({
    status: HttpStatus.OK,
    type: [UserDTO],
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public async find(@Query() query: UsersFindQuery): Promise<PaginationResponseDTO<UserDTO>> {
    return this.logger.trackSegment(this.find.name, async () => this.queryBus.execute(query));
  }

  @Get('me')
  @UseGuards(IsAuthenticatedGuard)
  // No need for NotFoundInterceptor
  @ApiResponse({ status: HttpStatus.OK, type: UserDTO })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: `User doesn't exist in database yet. Create it using "POST /users" request.`,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public getMe(@Res({ passthrough: true }) res: Response, @ReqUser() user: null | User): null | UserDTO {
    return this.logger.trackSegmentSync(this.getMe.name, () => {
      if (!user) {
        res.status(HttpStatus.NO_CONTENT);
      }
      return user;
    });
  }

  @Get('is-username-free/:userName')
  @UseGuards(IsAuthenticatedGuard)
  @ApiResponse({ status: HttpStatus.OK, type: UserIsUsernameFreeDTO })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public async isUsernameFree(@Param('userName') userName: string): Promise<UserIsUsernameFreeDTO> {
    return this.logger.trackSegment(this.isUsernameFree.name, async () => {
      const query = new UserIsUsernameFreeQuery(userName);
      const isFree = await this.queryBus.execute<boolean>(query);
      return { isFree };
    });
  }

  @Get(':id')
  @Cache(CacheAccess.shared, CacheTTL.week)
  @UseGuards(DoesUserExistGuard)
  @UseInterceptors(NotFoundInterceptor)
  @ApiResponse({ status: HttpStatus.OK, type: UserDTO })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  @ApiParam({ name: 'id', type: String })
  public async get(@Param('id') id: string): Promise<UserDTO> {
    return this.logger.trackSegment(this.get.name, async () => this.queryBus.execute(new UserGetQuery(id)));
  }

  @Post()
  @UseGuards(IsAuthenticatedGuard)
  @ApiResponse({ status: HttpStatus.CREATED, type: UserDTO })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'User with this id already exists or username is taken.' })
  public async create(@Body() command: UserCreateCommand, @ReqUserId() currentUserId: string): Promise<UserDTO> {
    command.id = currentUserId;
    return this.logger.trackSegment(this.create.name, async () => this.commandBus.execute(command));
  }

  @Patch('me')
  @UseGuards(DoesUserExistGuard)
  @UseInterceptors(NotFoundInterceptor)
  @ApiResponse({ status: HttpStatus.OK, type: UserDTO })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public async update(@Body() command: UserUpdateCommand, @ReqUserId() currentUserId: string): Promise<UserDTO> {
    command.id = currentUserId;
    return this.logger.trackSegment(this.update.name, async () => this.commandBus.execute(command));
  }

  @Patch('me/last-signin')
  @UseGuards(DoesUserExistGuard)
  @ApiResponse({ status: HttpStatus.OK, type: UserDTO })
  public async updateLastSignedIn(@ReqUserId() currentUserId: string): Promise<UserDTO> {
    const command = new UserUpdateLastSignedInCommand(currentUserId);
    return this.logger.trackSegment(this.updateLastSignedIn.name, async () => this.commandBus.execute(command));
  }

  @Delete('me')
  @UseGuards(DoesUserExistGuard)
  @ApiResponse({ status: HttpStatus.NO_CONTENT }) // Success
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public async delete(
    @Res({ passthrough: true }) res: Response,
    @Body() command: UserDeleteCommand,
    @ReqUserId() currentUserId: string,
  ): Promise<void> {
    command.id = currentUserId;
    await this.logger.trackSegment(this.delete.name, async () => this.commandBus.execute(command));
    res.status(HttpStatus.NO_CONTENT);
  }
}
