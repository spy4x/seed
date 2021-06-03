import { Environment } from '@seed/shared/types';
import { FrontFirebaseConfig } from '@seed/front/shared/types';

export const FRONT_WEB_CLIENT_CONFIG_INJECTION_TOKEN = 'FRONT_WEB_CLIENT_CONFIG_INJECTION_TOKEN';

export interface FrontWebClientConfig {
  environment: Environment;
  firebase: FrontFirebaseConfig;
}
