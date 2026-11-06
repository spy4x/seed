// Seed's own site: see docs/start-a-product.md
import type { JSX } from "preact"
import { useEffect, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { CopyButton } from "@spy4x/preact-ui/copy-button"

/** The words of the two buttons, in the page's language. */
export interface ChecklistActionsProps {
  copy: string
  copied: string
  copyFailed: string
  printLabel: string
}

/**
 * The checklist's Copy link and Print checklist buttons. Both need a script, so they appear only
 * once it runs; the page reserves their row. Copy link copies the page's address, never the ticks.
 */
export default function ChecklistActions(
  { copy, copied, copyFailed, printLabel }: ChecklistActionsProps,
): JSX.Element | null {
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  if (!ready) return null
  return (
    <div class="flex flex-wrap gap-3">
      <CopyButton
        textToCopy={() => `${location.origin}${location.pathname}`}
        title={copy}
        copiedLabel={copied}
        failedLabel={copyFailed}
        copiedForMs={3000}
        class="h-8 px-3 text-sm"
        data-e2e="checklist-copy"
      />
      <Button
        variant="outline"
        class="h-8"
        onClick={() => globalThis.print()}
        data-e2e="checklist-print"
      >
        {printLabel}
      </Button>
    </div>
  )
}
