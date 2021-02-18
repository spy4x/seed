import { scriptWrapper } from './scriptWrapper';
import { actionExample } from './actions/_example';

async function bootstrap() {
  await scriptWrapper(actionExample);
}

bootstrap();
