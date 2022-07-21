import { Environment } from '@seed/shared/types';
import { FrontFirebaseConfig } from '@seed/front/shared/types';

export const FRONT_ADMIN_PANEL_CONFIG_INJECTION_TOKEN = 'FRONT_ADMIN_PANEL_CONFIG_INJECTION_TOKEN';

export interface FrontAdminPanelConfig {
  environment: Environment;
  firebase: FrontFirebaseConfig;
}
