// Shows each key press that is not plain typing as a key cap near the bottom right of the page, for
// a recorded demo: a viewer cannot see the keyboard. Load it with `context.addInitScript({ path })`
// on the recording context only. It listens in the capture phase and changes nothing the page sees.
//
// A letter typed into a text field is typing and shows nothing; a shortcut shows with its
// modifiers ("Ctrl K"). `window.__demoKey(label)` shows a key the page never receives, such as the
// browser's own F5. The cap sits above the caption band the encoder burns in, and lives in the top
// layer like the pointer, so an open `<dialog>` does not hide it.
;(() => {
  if (globalThis !== globalThis.top) return
  const NAMES = {
    " ": `Space`,
    ArrowUp: `↑`,
    ArrowDown: `↓`,
    ArrowLeft: `←`,
    ArrowRight: `→`,
    Backspace: `⌫`,
    Enter: `Enter`,
    Escape: `Esc`,
    Tab: `Tab`,
  }
  const MODIFIERS = [[`ctrlKey`, `Ctrl`], [`altKey`, `Alt`], [`metaKey`, `Meta`]]
  const cap = document.createElement(`div`)
  cap.setAttribute(`aria-hidden`, `true`)
  cap.dataset.demo = ``
  cap.popover = `manual`
  Object.assign(cap.style, {
    position: `fixed`,
    inset: `auto`,
    right: `24px`,
    bottom: `108px`,
    margin: `0`,
    padding: `10px 18px`,
    borderRadius: `12px`,
    border: `2px solid #5b6070`,
    background: `#1b1e26`,
    color: `#f2f2f5`,
    font: `600 26px/1 ui-monospace, monospace`,
    boxShadow: `0 4px 18px rgba(0,0,0,.6)`,
    pointerEvents: `none`,
    zIndex: `2147483647`,
    opacity: `0`,
    transition: `opacity 120ms ease-out`,
  })
  const raise = () => {
    if (!cap.isConnected) document.documentElement?.appendChild(cap)
    if (!cap.isConnected) return
    try {
      if (cap.matches(`:popover-open`)) cap.hidePopover()
      cap.showPopover()
    } catch { /* no popover support: it stays a fixed element on top */ }
  }
  let timer = 0
  const show = (label) => {
    raise()
    cap.textContent = label
    cap.style.opacity = `1`
    clearTimeout(timer)
    timer = setTimeout(() => (cap.style.opacity = `0`), 1100)
  }
  globalThis.__demoKey = show
  // A checkbox or a button is no text field: Space on it is worth showing.
  const FIELD = `textarea, select, input:not([type=checkbox], [type=radio], [type=button], ` +
    `[type=submit], [type=reset])`
  const typing = (event) => {
    const target = event.composedPath()[0]
    return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey &&
      target instanceof HTMLElement && (target.isContentEditable || target.matches(FIELD))
  }
  addEventListener(`keydown`, (event) => {
    if ([`Shift`, `Control`, `Alt`, `Meta`].includes(event.key) || typing(event)) return
    if (event.key.length > 1 && !(event.key in NAMES) && !/^F\d+$/.test(event.key)) return
    const key = NAMES[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key)
    const held = MODIFIERS.filter(([flag]) => event[flag]).map(([, name]) => name)
    show([...held, key].join(` `))
  }, true)
  // Raised again when a dialog the key opened lands on top of it.
  let layers = -1
  setInterval(() => {
    const open = document.querySelectorAll(`:modal, :popover-open:not([data-demo])`).length
    if (open === layers) return
    layers = open
    if (cap.isConnected) raise()
  }, 50)
})()
