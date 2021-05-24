import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  CreateUserCommand,
  CurrentUserDetailsDto,
  FindUsersQuery,
  GetCurrentUserQuery,
  GetUserQuery,
  IsAuthenticatedGuard,
  IsUsernameFreeQuery,
  LogService,
  NotFoundInterceptor,
  Pagination,
  SignInUserCommand,
  UpdateUserCommand,
  UserDetailsDto,
  UserDto,
  UserId,
  UsernameFreeDto,
} from '@seed/back/api/shared';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  logger = new LogService(UsersController.name);

  constructor(private readonly queryBus: QueryBus, private readonly commandBus: CommandBus) {}

  @Get()
  @UseGuards(IsAuthenticatedGuard)
  @ApiResponse({
    status: 200,
    type: Pagination,
  })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  public async find(@Query() query: FindUsersQuery, @UserId() currentUserId: string): Promise<Pagination<UserDto>> {
    query.currentUserId = currentUserId;

    return this.logger.trackSegment<Pagination<UserDto>>(this.find.name, async () => this.queryBus.execute(query));
  }

  @Get('me')
  @UseGuards(IsAuthenticatedGuard)
  @UseInterceptors(NotFoundInterceptor)
  @ApiResponse({ status: 200, type: UserDetailsDto })
  @ApiResponse({ status: 403 })
  public async getMe(@UserId() currentUserId: string): Promise<CurrentUserDetailsDto> {
    return this.logger.trackSegment<CurrentUserDetailsDto>(this.getMe.name, async () =>
      this.queryBus.execute(new GetCurrentUserQuery(currentUserId)),
    );
  }

  @Get('is-username-free/:userName')
  @UseGuards(IsAuthenticatedGuard)
  @ApiResponse({ status: 200, type: UsernameFreeDto })
  @ApiResponse({ status: 403 })
  public async isUsernameFree(@Param() query: IsUsernameFreeQuery): Promise<UsernameFreeDto> {
    return this.logger.trackSegment<UsernameFreeDto>(this.isUsernameFree.name, async () => {
      const isFree = await this.queryBus.execute<IsUsernameFreeQuery, boolean>(query);
      return { isFree };
    });
  }

  @Get(':id')
  @UseGuards(IsAuthenticatedGuard)
  @UseInterceptors(NotFoundInterceptor)
  @ApiResponse({ status: 200, type: UserDetailsDto })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  @ApiParam({ name: 'id', type: String })
  public async get(@Param('id') id: string, @UserId() currentUserId: string): Promise<UserDetailsDto> {
    const query = new GetUserQuery(id);
    query.currentUserId = currentUserId;

    return this.logger.trackSegment<UserDetailsDto>(this.get.name, async () => this.queryBus.execute(query));
  }

  @Post()
  @UseGuards(IsAuthenticatedGuard)
  @ApiResponse({ status: 201, type: UserDetailsDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  public async create(@Body() command: CreateUserCommand, @UserId() currentUserId: string): Promise<UserDetailsDto> {
    command.id = currentUserId;
    return this.logger.trackSegment<UserDetailsDto>(
      this.create.name,
      async () => this.commandBus.execute(command) as Promise<UserDetailsDto>,
    );
  }

  @Patch('me')
  @UseGuards(IsAuthenticatedGuard)
  @UseInterceptors(NotFoundInterceptor)
  @ApiResponse({ status: 200, type: UserDetailsDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  public async update(@Body() command: UpdateUserCommand, @UserId() currentUserId: string): Promise<UserDetailsDto> {
    command.id = currentUserId;
    return this.logger.trackSegment<UserDetailsDto>(
      this.update.name,
      async () => this.commandBus.execute(command) as Promise<UserDetailsDto>,
    );
  }

  @Patch('me/last-signin')
  @UseGuards(IsAuthenticatedGuard)
  public async updateLastSignedIn(@UserId() currentUserId: string): Promise<Date> {
    const command = new SignInUserCommand(currentUserId);
    return this.logger.trackSegment<Date>(
      this.updateLastSignedIn.name,
      async () => this.commandBus.execute(command) as Promise<Date>,
    );
  }
}
