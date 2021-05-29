import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  BaseController,
  IsAuthenticatedGuard,
  NotFoundInterceptor,
  PaginationResponseDTO,
  UserCreateCommand,
  UserDTO,
  UserGetMeQuery,
  UserGetQuery,
  UserId,
  UserIsUsernameFreeDTO,
  UserIsUsernameFreeQuery,
  UserMeDTO,
  UsersFindQuery,
  UserUpdateCommand,
  UserUpdateLastSignedInCommand,
} from '@seed/back/api/shared';
import { ApiBearerAuth, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController extends BaseController {
  @Get()
  @UseGuards(IsAuthenticatedGuard)
  @ApiResponse({
    status: 200,
    type: PaginationResponseDTO,
  })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  public async find(
    @Query() query: UsersFindQuery,
    @UserId() currentUserId: string,
  ): Promise<PaginationResponseDTO<UserDTO>> {
    query.currentUserId = currentUserId;

    return this.logger.trackSegment<PaginationResponseDTO<UserDTO>>(this.find.name, async () =>
      this.queryBus.execute(query),
    );
  }

  @Get('me')
  @UseGuards(IsAuthenticatedGuard)
  @UseInterceptors(NotFoundInterceptor)
  @ApiResponse({ status: 200, type: UserMeDTO })
  @ApiResponse({ status: 403 })
  public async getMe(@UserId() currentUserId: string): Promise<UserMeDTO> {
    return this.logger.trackSegment<UserMeDTO>(this.getMe.name, async () =>
      this.queryBus.execute(new UserGetMeQuery(currentUserId)),
    );
  }

  @Get('is-username-free/:userName')
  @UseGuards(IsAuthenticatedGuard)
  @ApiResponse({ status: 200, type: UserIsUsernameFreeDTO })
  @ApiResponse({ status: 403 })
  public async isUsernameFree(@Param() query: UserIsUsernameFreeQuery): Promise<UserIsUsernameFreeDTO> {
    return this.logger.trackSegment<UserIsUsernameFreeDTO>(this.isUsernameFree.name, async () => {
      const isFree = await this.queryBus.execute<UserIsUsernameFreeQuery, boolean>(query);
      return { isFree };
    });
  }

  @Get(':id')
  @UseGuards(IsAuthenticatedGuard)
  @UseInterceptors(NotFoundInterceptor)
  @ApiResponse({ status: 200, type: UserDTO })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  @ApiParam({ name: 'id', type: String })
  public async get(@Param('id') id: string, @UserId() currentUserId: string): Promise<UserDTO> {
    const query = new UserGetQuery(id);
    query.currentUserId = currentUserId;
    return this.logger.trackSegment<UserDTO>(this.get.name, async () => this.queryBus.execute(query));
  }

  @Post()
  @UseGuards(IsAuthenticatedGuard)
  @ApiResponse({ status: 201, type: UserMeDTO })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  public async create(@Body() command: UserCreateCommand, @UserId() currentUserId: string): Promise<UserMeDTO> {
    command.id = currentUserId;
    return this.logger.trackSegment<UserMeDTO>(
      this.create.name,
      async () => this.commandBus.execute(command) as Promise<UserMeDTO>,
    );
  }

  @Patch('me')
  @UseGuards(IsAuthenticatedGuard)
  @UseInterceptors(NotFoundInterceptor)
  @ApiResponse({ status: 200, type: UserMeDTO })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  public async update(@Body() command: UserUpdateCommand, @UserId() currentUserId: string): Promise<UserMeDTO> {
    command.id = currentUserId;
    return this.logger.trackSegment<UserMeDTO>(
      this.update.name,
      async () => this.commandBus.execute(command) as Promise<UserMeDTO>,
    );
  }

  @Patch('me/last-signin')
  @UseGuards(IsAuthenticatedGuard)
  @ApiResponse({ status: 200, type: UserMeDTO })
  public async updateLastSignedIn(@UserId() currentUserId: string): Promise<UserMeDTO> {
    const command = new UserUpdateLastSignedInCommand(currentUserId);
    return this.logger.trackSegment<UserMeDTO>(
      this.updateLastSignedIn.name,
      async () => this.commandBus.execute(command) as Promise<UserMeDTO>,
    );
  }
}
