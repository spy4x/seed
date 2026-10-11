import { installOfflineShell, type ShellScope } from "@spy4x/platform/browser/offline-shell"
import {
  installPushNotifications,
  type PushScope,
} from "@spy4x/platform/browser/push-notifications"
import { shellOptions } from "./sw-options.ts"

/** Set by the build (`serviceWorker()` in `vite.config.ts`) to a hash of the built files. */
declare const __BUILD_ID__: string

// Offline shell cache; the app opens with no network. Also answers `SWUpdater`'s `skipWaiting`
// message, which a visitor sends by accepting the "New version available" prompt.
installOfflineShell(self as unknown as ShellScope, shellOptions(__BUILD_ID__))

// Shows a pushed notification and opens the app where it points when the notification is clicked.
installPushNotifications(self as unknown as PushScope)
