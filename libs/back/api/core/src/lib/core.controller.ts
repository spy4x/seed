import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('core')
@ApiBearerAuth()
@Controller('')
export class CoreController {
  @Get('wake-up')
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public wakeup(): void {}
}
