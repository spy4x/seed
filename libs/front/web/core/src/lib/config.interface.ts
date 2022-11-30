import { Environment } from '@seed/shared/types';
import { FrontFirebaseConfig } from '@seed/front/shared/types';

export const FRONT_WEB_CONFIG_TOKEN = 'FRONT_WEB_CONFIG_TOKEN';

export interface FrontWebClientConfig {
  environment: Environment;
  firebase: FrontFirebaseConfig;
}
