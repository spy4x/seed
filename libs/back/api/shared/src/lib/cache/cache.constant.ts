import { DAYS_IN_WEEK, HOURS_IN_DAY, MINUTES_IN_HOUR, SECONDS_IN_MINUTE } from '@seed/shared/constants';

export enum CacheAccess {
  shared = 'shared',
  userSpecific = 'userSpecific',
}

/**
 * Values in seconds
 */
/* eslint-disable @typescript-eslint/prefer-literal-enum-member */
export enum CacheTTL {
  /* eslint-disable-next-line @typescript-eslint/no-magic-numbers */
  threeMin = 3 * SECONDS_IN_MINUTE,
  oneHour = MINUTES_IN_HOUR * SECONDS_IN_MINUTE,
  day = HOURS_IN_DAY * MINUTES_IN_HOUR * SECONDS_IN_MINUTE,
  week = DAYS_IN_WEEK * HOURS_IN_DAY * MINUTES_IN_HOUR * SECONDS_IN_MINUTE,
}
/* eslint-enable @typescript-eslint/prefer-literal-enum-member */
