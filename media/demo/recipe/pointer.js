// Draws a mouse pointer and a click mark into the page, for a recorded demo: headless Chromium
// records no system cursor. Load it with `context.addInitScript({ path })` on the recording context
// only. It follows real mouse events (capture phase), so the Playwright mouse drives it and the
// app's own hover states stay real.
//
// Options, set by an earlier init script: `window.__demoPointerOptions = { x, y, accent, mark,
// iframes }`.
// - `x`, `y`: the start position (default 40, 40). The position is kept across navigations in
//   `sessionStorage`, which does not cross origins: a page on another origin starts at `x`, `y`.
// - `accent`: the click mark's colour (default `#38bdf8`). `mark`: its diameter in CSS pixels
//   (default 64, right for a 1280 px clip).
// - `iframes: "shield"`: iframes ignore the mouse, so the pointer keeps moving over them (the page
//   gets no mousemove while the mouse is over an iframe). Such an iframe cannot be clicked.
//
// `window.__demoPointerVisible(false)` hides the pointer for a still, such as the poster.
//
// The pointer and the marks are manual popovers in the top layer, raised again whenever a modal
// dialog or another popover opens, so a `<dialog>` never hides them. They are built and styled
// through the DOM and the CSSOM, which a strict `style-src` allows.
;(() => {
  if (globalThis !== globalThis.top) return
  const options = globalThis.__demoPointerOptions ?? {}
  const KEY = `__demoPointer`
  let pos = { x: options.x ?? 40, y: options.y ?? 40 }
  let place = () => {}
  // Listen first, so nothing below that throws can leave the pointer frozen.
  addEventListener(`mousemove`, (e) => {
    pos = { x: e.clientX, y: e.clientY }
    place()
    try {
      sessionStorage.setItem(KEY, JSON.stringify(pos))
    } catch { /* storage blocked: the position lives in memory only */ }
  }, true)
  try {
    pos = JSON.parse(sessionStorage.getItem(KEY)) ?? pos
  } catch { /* storage blocked: keep the start position */ }

  const ACCENT = options.accent ?? `#38bdf8`
  const MARK = options.mark ?? 64
  const style = (node, props) => Object.assign(node.style, props)
  /** A node in the top layer that the page cannot see or click. */
  const layer = (tag) => {
    const node = document.createElement(tag)
    node.setAttribute(`aria-hidden`, `true`)
    node.dataset.demo = ``
    node.popover = `manual`
    style(node, {
      position: `fixed`,
      inset: `auto`,
      left: `0`,
      top: `0`,
      margin: `0`,
      border: `0`,
      padding: `0`,
      background: `transparent`,
      overflow: `visible`,
      pointerEvents: `none`,
      zIndex: `2147483647`,
    })
    return node
  }
  /** Puts `node` on top of the top layer. Before `<html>` exists there is nothing to attach to. */
  const raise = (node) => {
    if (!node.isConnected) document.documentElement?.appendChild(node)
    if (!node.isConnected) return
    try {
      if (node.matches(`:popover-open`)) node.hidePopover()
      node.showPopover()
    } catch { /* no popover support: it stays a fixed element on top */ }
  }

  const el = layer(`div`)
  style(el, { width: `24px`, height: `28px`, filter: `drop-shadow(0 1px 2px rgba(0,0,0,.6))` })
  const NS = `http://www.w3.org/2000/svg`
  const svg = document.createElementNS(NS, `svg`)
  const arrow = document.createElementNS(NS, `path`)
  const attrs = (node, values) => {
    for (const [name, value] of Object.entries(values)) node.setAttribute(name, value)
  }
  attrs(svg, { width: `24`, height: `28`, viewBox: `0 0 24 28` })
  attrs(arrow, {
    d: `M3 2 L3 21.5 L8.3 16.4 L11.9 24.6 L15.3 23.1 L11.8 15.1 L19 14.8 Z`,
    fill: `#fff`,
    stroke: `#111`,
    "stroke-width": `1.6`,
    "stroke-linejoin": `round`,
  })
  style(svg, {
    display: `block`,
    transformOrigin: `3px 2px`,
    transition: `transform 90ms ease-out`,
  })
  svg.appendChild(arrow)
  el.appendChild(svg)
  // Hides the pointer for a still, such as the poster.
  globalThis.__demoPointerVisible = (visible) => {
    el.style.visibility = visible ? `` : `hidden`
  }

  // The arrow's tip (3, 2) is the hotspot.
  let layers = -1
  const open = () => document.querySelectorAll(`:modal, :popover-open:not([data-demo])`).length
  const mount = () => {
    const now = open()
    if (el.isConnected && now === layers) return
    raise(el)
    layers = now
  }
  place = () => {
    el.style.transform = `translate(${pos.x - 3}px,${pos.y - 2}px)`
    mount()
  }
  place()
  document.addEventListener(`DOMContentLoaded`, place)
  setInterval(mount, 50)

  if (options.iframes === `shield`) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(`iframe { pointer-events: none !important }`)
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  }

  // Opaque ring and dot, so the colour survives a GIF palette and video compression. Removed when
  // the animation ends, and at once when the page unloads, so a slow navigation never freezes a
  // half-drawn mark on screen.
  const marks = new Set()
  const clear = () => {
    for (const mark of marks) mark.remove()
    marks.clear()
  }
  addEventListener(`beforeunload`, clear, true)
  addEventListener(`pagehide`, clear, true)
  addEventListener(`mousedown`, (e) => {
    svg.style.transform = `scale(.7)`
    const mark = layer(`div`)
    const dot = Math.round(MARK * 0.16)
    style(mark, {
      left: `${e.clientX - MARK / 2}px`,
      top: `${e.clientY - MARK / 2}px`,
      width: `${MARK}px`,
      height: `${MARK}px`,
      borderRadius: `50%`,
      boxSizing: `border-box`,
      border: `${Math.round(MARK / 16)}px solid ${ACCENT}`,
      background: `radial-gradient(circle, ${ACCENT} 0 ${dot}px, transparent ${dot + 1}px)`,
    })
    raise(mark)
    raise(el)
    marks.add(mark)
    mark.animate([
      { transform: `scale(.25)`, opacity: 1 },
      { transform: `scale(.8)`, opacity: 1, offset: 0.5 },
      { transform: `scale(1)`, opacity: 0 },
    ], { duration: 400, easing: `ease-out`, fill: `forwards` }).onfinish = () => {
      mark.remove()
      marks.delete(mark)
    }
  }, true)
  addEventListener(`mouseup`, () => {
    svg.style.transform = ``
  }, true)
})()
