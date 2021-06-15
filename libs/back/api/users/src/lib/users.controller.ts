import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  BaseController,
  IsAuthenticatedGuard,
  NotFoundInterceptor,
  PaginationResponseDTO,
  UserCreateCommand,
  UserGetQuery,
  UserId,
  UserIsUsernameFreeDTO,
  UserIsUsernameFreeQuery,
  UserDTO,
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
  @UseInterceptors(NotFoundInterceptor)
  @ApiResponse({ status: HttpStatus.OK, type: UserDTO })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public async getMe(@UserId() currentUserId: string): Promise<UserDTO> {
    return this.logger.trackSegment(this.getMe.name, async () =>
      this.queryBus.execute(new UserGetQuery(currentUserId)),
    );
  }

  @Get('is-username-free/:userName')
  @UseGuards(IsAuthenticatedGuard)
  @ApiResponse({ status: HttpStatus.OK, type: UserIsUsernameFreeDTO })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public async isUsernameFree(@Param() query: UserIsUsernameFreeQuery): Promise<UserIsUsernameFreeDTO> {
    return this.logger.trackSegment(this.isUsernameFree.name, async () => {
      const isFree = await this.queryBus.execute<boolean>(query);
      return { isFree };
    });
  }

  @Get(':id')
  @UseGuards(IsAuthenticatedGuard)
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
  public async create(@Body() command: UserCreateCommand, @UserId() currentUserId: string): Promise<UserDTO> {
    command.id = currentUserId;
    return this.logger.trackSegment(this.create.name, async () => this.commandBus.execute(command));
  }

  @Patch('me')
  @UseGuards(IsAuthenticatedGuard)
  @UseInterceptors(NotFoundInterceptor)
  @ApiResponse({ status: HttpStatus.OK, type: UserDTO })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  public async update(@Body() command: UserUpdateCommand, @UserId() currentUserId: string): Promise<UserDTO> {
    command.id = currentUserId;
    return this.logger.trackSegment(this.update.name, async () => this.commandBus.execute(command));
  }

  @Patch('me/last-signin')
  @UseGuards(IsAuthenticatedGuard)
  @ApiResponse({ status: HttpStatus.OK, type: UserDTO })
  public async updateLastSignedIn(@UserId() currentUserId: string): Promise<UserDTO> {
    const command = new UserUpdateLastSignedInCommand(currentUserId);
    return this.logger.trackSegment(this.updateLastSignedIn.name, async () => this.commandBus.execute(command));
  }
}
