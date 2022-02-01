import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BaseController } from '@seed/back/api/shared';

@ApiTags('core')
@ApiBearerAuth()
@Controller('')
export class CoreController extends BaseController {
  @Get('wake-up')
  public wakeup(): { status: string; message: string } {
    return {
      status: 'OK',
      message: `Server time: ${new Date().toISOString()}`,
    };
  }
}
