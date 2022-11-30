import { Environment } from '@seed/shared/types';
import { FrontFirebaseConfig } from '@seed/front/shared/types';

export const FRONT_ADMIN_CONFIG_TOKEN = 'FRONT_ADMIN_CONFIG_TOKEN';

export interface FrontAdminPanelConfig {
  environment: Environment;
  firebase: FrontFirebaseConfig;
}
