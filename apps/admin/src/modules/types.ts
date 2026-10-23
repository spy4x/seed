import type { ComponentChildren, ComponentType } from "preact"
import type { IconProps } from "@spy4x/preact-icons"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import type { User } from "@domain/identity"
import type { Formatters } from "@spy4x/time/format"
import type { LeaveGuard } from "@spy4x/preact-ui/unsaved-guard"
import type { AdminFetch } from "../state.ts"

/**
 * What every module's page gets from the app: the API, the toasts, the operator and the router.
 * Built once per signed-in session (`app.tsx`), so a module may key its own state on it.
 */
export interface AdminContext {
  /** Calls the API on the app's own origin. A 401 signs the app out; the caller sees the failure. */
  request: AdminFetch
  toasts: ToastStore
  /** The signed-in operator. */
  operator: User
  /**
   * The router's `navigate`, asking first while a page holds unsaved changes (`leave.ts`). A page's
   * `UnsavedGuard` takes the router's own `navigate` instead (`useLocation`).
   */
  navigate: (href: string, options?: { replace?: boolean }) => void
  /** The app's one guard: a page's `UnsavedGuard` gets it as `leaveGuard`, so `navigate` asks. */
  leaveGuard: LeaveGuard
  /** Every module's tabs for the person page, in registry order (`registry.ts`). */
  personTabs: readonly AdminPersonTab[]
  /** The operator's own formatter: their region format, time zone and clock (#163). */
  format(): Formatters
}

/** One page of a module: a wouter path pattern and the view that fills the frame there. */
export interface AdminRoute {
  path: string
  View: ComponentType<{ context: AdminContext; params: Record<string, string> }>
}

/** A tab a module adds to the person page (`/users/:id`), after the page's own tabs. */
export interface AdminPersonTab {
  id: string
  label: string
  /**
   * The tab's content. Its elements mount only while the tab is open, so a component it returns
   * may load its own data when it mounts.
   */
  render: (props: { context: AdminContext; userId: number }) => ComponentChildren
}

/**
 * One section of the operator area (`docs/admin-modules.md`): its sidebar entry, its pages and,
 * optionally, tabs on the person page. Its API lives in `apps/api/routes/admin/<id>.ts`.
 */
export interface AdminModule {
  /** The same id as the API module. */
  id: string
  /** The sidebar entry; its `href` is the module's first page. */
  nav: { name: string; href: string; Icon: ComponentType<IconProps> }
  routes: readonly AdminRoute[]
  personTabs?: readonly AdminPersonTab[]
}
