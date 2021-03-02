import { scriptWrapper } from './scriptWrapper';
import { actionExample } from './actions/_example';

async function bootstrap(): Promise<void> {
  await scriptWrapper(actionExample);
}

void bootstrap();
