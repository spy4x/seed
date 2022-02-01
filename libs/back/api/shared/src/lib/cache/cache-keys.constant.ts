export const CACHE_KEYS = {
  jwt: (token: string): string => `jwt_${token}`,
};
