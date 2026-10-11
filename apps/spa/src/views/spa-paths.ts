/** The paths the SPA's router owns: its routes in `app.tsx`. Keep the two lists the same. */
export function isSpaPath(pathname: string): boolean {
  return pathname === "/" ||
    /^\/(notes|tags|groups|notifications|sign-in|sign-up|totp|forgot-password|reset-password|email|subscribe|unsubscribe)(\/|$)/
      .test(
        pathname,
      )
}
