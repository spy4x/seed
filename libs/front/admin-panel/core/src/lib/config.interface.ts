import { Environment } from '@seed/shared/types';

export const FRONT_ADMIN_PANEL_CONFIG_INJECTION_TOKEN = 'FRONT_ADMIN_PANEL_CONFIG_INJECTION_TOKEN';

export interface FrontAdminPanelConfig {
  environment: Environment;
}
