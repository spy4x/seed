import { applyDecorators, Header } from '@nestjs/common';
import { CacheAccess, CacheTTL } from '../../../cache';

/* eslint-enable @typescript-eslint/prefer-literal-enum-member */

/**
 * Returns tuple of header name and header value for Cache-Control with specific TTL.
 * @param ttl - Time-to-live for cache
 */
export function getCacheControlHeader(ttl: CacheTTL): [string, string] {
  return ['Cache-Control', `public, s-maxage=${ttl}`];
}

/**
 * Returns decorators that set Response Headers for CDN/client Cache
 * @param access - Should content of the cache be shared or specific/private to a user?
 * @param ttl - Time-to-live for cache
 * @constructor
 */
export function Cache(access: CacheAccess, ttl: CacheTTL): MethodDecorator {
  const generalCacheControlHeader = Header(...getCacheControlHeader(ttl));
  const decorators = [generalCacheControlHeader];

  switch (access) {
    case CacheAccess.userSpecific: {
      const veryHeader = Header('Vary', `Authorization`); // CDN cache key now includes Request.Headers.Authorization value
      decorators.push(veryHeader);
      break;
    }
    case CacheAccess.shared:
      // nothing to do
      break;
    default:
      throw new Error('Not implemented');
  }

  return applyDecorators(...decorators);
}
