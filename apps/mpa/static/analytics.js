// The events Umami's own tracker cannot see on this website (docs/analytics.md). `_app.tsx` loads
// this file after the tracker, only when analytics is on. Without the tracker it sends nothing, and
// the page never depends on it: every link, form and video works without JavaScript.
;(() => {
  const script = document.currentScript
  const spaOrigin = script?.dataset.spaOrigin ?? ""
  const repository = script?.dataset.repository ?? ""
  const track = (name, data) => {
    try {
      globalThis.umami?.track(name, data)
    } catch {
      // Analytics never breaks the page.
    }
  }
  // Where on the page: in the content, the nearest element with an id; else the site's header or
  // footer.
  const from = (element) => {
    if (element.closest("main")) return element.closest("[id]:not(main)")?.id ?? "page"
    return element.closest("footer") ? "footer" : element.closest("header") ? "header" : "page"
  }

  // Events a page sends by being shown: the 404 page, a finished newsletter step.
  addEventListener("load", () => {
    for (const element of document.querySelectorAll("[data-analytics-view]")) {
      track(element.dataset.analyticsView, { path: location.pathname })
    }
  })

  // A link that names no event of its own, such as the header's and the footer's, which the shared
  // components draw. Links inside `data-umami-event` are Umami's to count.
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null
    if (!link || link.closest("[data-umami-event]")) return
    const url = new URL(link.href, location.href)
    const place = from(link)
    if (url.origin === location.origin) {
      track("internal-link", { to: `${url.pathname}${url.hash}`, from: place })
    } else if (repository && url.href.startsWith(repository)) track("github", { from: place })
    else if (url.origin === spaOrigin) {
      track(url.pathname === "/sign-in" ? "sign-in" : "try-demo", { from: place })
    } else track("outbound-link", { url: url.href, from: place })
  }, true)

  // A form the shared components draw: the event names the wrapper, the property one field.
  document.addEventListener("submit", (event) => {
    const form = event.target
    const wrapper = form instanceof Element ? form.closest("[data-analytics-submit]") : null
    if (!wrapper) return
    const field = wrapper.dataset.analyticsField
    const value = field ? form.elements.namedItem(field)?.value : undefined
    track(wrapper.dataset.analyticsSubmit, field ? { [field]: value } : undefined)
  }, true)

  // A video: the first play, each quarter watched once, and the end.
  for (const video of document.querySelectorAll("video[data-analytics-video]")) {
    const name = video.dataset.analyticsVideo
    const sent = new Set()
    const once = (key, event, data) => {
      if (sent.has(key)) return
      sent.add(key)
      track(event, data)
    }
    video.addEventListener("play", () => once("play", `${name}-play`))
    video.addEventListener("timeupdate", () => {
      if (!video.duration) return
      const watched = (video.currentTime / video.duration) * 100
      for (const percent of [25, 50, 75, 100]) {
        if (watched >= percent) once(percent, `${name}-progress`, { percent })
      }
    })
    video.addEventListener("ended", () => {
      once(100, `${name}-progress`, { percent: 100 })
      track(`${name}-ended`)
    })
  }
})()
