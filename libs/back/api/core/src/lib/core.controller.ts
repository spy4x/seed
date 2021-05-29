import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BaseController } from '@seed/back/api/shared';

@ApiTags('core')
@ApiBearerAuth()
@Controller('')
export class CoreController extends BaseController {
  @Get('wake-up')
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public wakeup(): void {}
}
