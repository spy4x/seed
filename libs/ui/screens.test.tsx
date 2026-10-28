import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { VNode } from "preact"
import { renderToString } from "preact-render-to-string"
import { AuthScreen, type AuthScreenProps } from "./auth-screen.tsx"
import { FORM_ACTIONS, SCREEN_PATHS } from "./progressive.tsx"
import { ForgotPasswordScreen, ResetPasswordScreen } from "./password-reset-screen.tsx"
import { subscribeSchema, subscriptionConfirmSchema, unsubscribeSchema } from "@domain/subscribers"
import { SubscribeForm, SubscriptionConfirmScreen, UnsubscribeScreen } from "./subscribe-screen.tsx"

/** One `<form>` in rendered HTML: its attributes and the names of the fields it submits. */
interface RenderedForm {
  action: string | undefined
  method: string | undefined
  fields: string[]
}

/** The rendered page, reduced to what works without JavaScript: forms, links, loose buttons. */
interface NoScriptSurface {
  forms: RenderedForm[]
  links: string[]
  /** `data-e2e` of every button outside a form, or of a non-submit button inside one. */
  scriptOnlyButtons: string[]
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
}

/** Renders `node` on the server and lists what a browser without JavaScript can act on. */
function noScriptSurface(node: VNode): NoScriptSurface {
  const html = renderToString(node)
  const forms: RenderedForm[] = []
  const outside = html.replace(/<form\b([^>]*)>([\s\S]*?)<\/form>/g, (_all, attrs, body) => {
    forms.push({
      action: attribute(` ${attrs}`, "action"),
      method: attribute(` ${attrs}`, "method"),
      fields: [...body.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)]
        .map(([tag]) => attribute(tag, "name"))
        .filter((name): name is string => name !== undefined)
        .sort(),
    })
    // Keep the non-submit buttons inside forms visible to the button scan below.
    return [...body.matchAll(/<button\b[^>]*>/g)]
      .map(([tag]) => tag)
      .filter((tag) => attribute(tag, "type") !== "submit")
      .join("")
  })
  const links = [...html.matchAll(/<a\b[^>]*>/g)].map(([tag]) => attribute(tag, "href") ?? "")
  // A disabled button is not an action: it does nothing with or without JavaScript.
  const scriptOnlyButtons = [...outside.matchAll(/<button\b[^>]*>/g)]
    .filter(([tag]) => !/\sdisabled(\s|=|>)/.test(tag))
    .map(([tag]) => attribute(tag, "data-e2e") ?? "(unnamed)")
  return { forms, links, scriptOnlyButtons }
}

/** The keys an API schema accepts, sorted: what a form's field names must be. */
function schemaKeys(schema: { props: readonly { key: string | symbol }[] }): string[] {
  return schema.props.map((prop) => String(prop.key)).sort()
}

function formAt(surface: NoScriptSurface, action: string): RenderedForm {
  const form = surface.forms.find((candidate) => candidate.action === action)
  if (!form) throw new Error(`no form posts to ${action}; forms: ${JSON.stringify(surface.forms)}`)
  return form
}

const authDefaults: AuthScreenProps = {
  screen: "sign-in",
  isSignedIn: false,
  isMfaRequired: false,
  busy: false,
  error: null,
}

describe("AuthScreen links", () => {
  it("links sign-in to a password reset and to sign-up", () => {
    const surface = noScriptSurface(<AuthScreen {...authDefaults} />)
    expect(surface.links).toEqual([SCREEN_PATHS.forgotPassword, SCREEN_PATHS.signUp])
  })

  it("switches between sign in and sign up with a plain link", () => {
    // Sign-in also links to a password reset.
    expect(noScriptSurface(<AuthScreen {...authDefaults} />).links).toEqual([
      SCREEN_PATHS.forgotPassword,
      "/sign-up",
    ])
    expect(noScriptSurface(<AuthScreen {...authDefaults} screen="sign-up" />).links)
      .toEqual(["/sign-in"])
  })

  it("links the one-time code step back to sign in", () => {
    const surface = noScriptSurface(
      <AuthScreen {...authDefaults} screen="one-time-code" isMfaRequired />,
    )
    expect(surface.links).toEqual(["/sign-in"])
  })

  it("keeps next on every link between the auth screens", () => {
    const next = "/notes/abc"
    const withNextQuery = (path: string) => `${path}?next=%2Fnotes%2Fabc`
    const signIn = noScriptSurface(<AuthScreen {...authDefaults} next={next} />)
    const signUp = noScriptSurface(<AuthScreen {...authDefaults} screen="sign-up" next={next} />)
    const code = noScriptSurface(
      <AuthScreen {...authDefaults} screen="one-time-code" isMfaRequired next={next} />,
    )
    expect(signIn.links).toEqual([SCREEN_PATHS.forgotPassword, withNextQuery(SCREEN_PATHS.signUp)])
    expect(signUp.links).toEqual([withNextQuery(SCREEN_PATHS.signIn)])
    expect(code.links).toEqual([withNextQuery(SCREEN_PATHS.signIn)])
  })

  it("links a signed-in user on to the profile instead of asking again", () => {
    const signedIn = noScriptSurface(<AuthScreen {...authDefaults} isSignedIn />)
    const noCodeOwed = noScriptSurface(<AuthScreen {...authDefaults} screen="one-time-code" />)
    for (const surface of [signedIn, noCodeOwed]) {
      expect(surface.forms).toEqual([])
      expect(surface.links).toEqual([SCREEN_PATHS.profile])
    }
  })
})

describe("ForgotPasswordScreen links", () => {
  const props = { email: "", onEmailChange: () => {}, error: null, pending: false }

  it("links back to sign in", () => {
    const surface = noScriptSurface(<ForgotPasswordScreen {...props} sent={false} />)
    expect(surface.links).toEqual([SCREEN_PATHS.signIn])
  })

  it("says the link is on its way and asks nothing more once it is sent", () => {
    const surface = noScriptSurface(<ForgotPasswordScreen {...props} sent />)
    expect(surface.forms).toEqual([])
    expect(surface.links).toEqual([SCREEN_PATHS.signIn])
  })
})

describe("ResetPasswordScreen links", () => {
  const props = {
    email: "ada@example.com",
    code: "code-from-the-link",
    newPassword: "",
    onNewPasswordChange: () => {},
    done: false,
    error: null,
    pending: false,
  }

  it("links an expired link to a new one", () => {
    const surface = noScriptSurface(<ResetPasswordScreen {...props} />)
    expect(surface.links).toEqual([SCREEN_PATHS.forgotPassword])
  })

  it("points to sign-in once the password is changed", () => {
    const surface = noScriptSurface(<ResetPasswordScreen {...props} done />)
    expect(surface.forms).toEqual([])
    expect(surface.links).toEqual([SCREEN_PATHS.signIn])
  })

  it("offers a new link instead of a form when the link lacks its address or code", () => {
    for (const broken of [{ email: "" }, { code: "" }]) {
      const surface = noScriptSurface(<ResetPasswordScreen {...props} {...broken} />)
      expect(surface.forms).toEqual([])
      expect(surface.links).toEqual([SCREEN_PATHS.forgotPassword])
    }
  })
})

describe("SubscribeForm without JavaScript", () => {
  const props = { email: "", onEmailChange: () => {}, list: "news", error: null, pending: false }

  it("posts the address and the list to the subscribe route", () => {
    const node = <SubscribeForm {...props} sent={false} />
    const surface = noScriptSurface(node)
    expect(surface.forms).toEqual([
      { action: FORM_ACTIONS.subscribe, method: "post", fields: schemaKeys(subscribeSchema) },
    ])
    expect(surface.scriptOnlyButtons).toEqual([])
    expect(renderToString(node)).toContain(`name="list" value="news"`)
  })

  it("says the link is on its way and asks nothing more once it is sent", () => {
    const surface = noScriptSurface(<SubscribeForm {...props} sent />)
    expect(surface.forms).toEqual([])
  })
})

describe("SubscriptionConfirmScreen without JavaScript", () => {
  const props = {
    state: "confirm" as const,
    list: "news",
    token: "token-from-the-link",
    error: null,
    pending: false,
  }

  it("posts the link's list and token to the confirm route", () => {
    const node = <SubscriptionConfirmScreen {...props} />
    const surface = noScriptSurface(node)
    expect(surface.forms).toEqual([
      {
        action: FORM_ACTIONS.subscribeConfirm,
        method: "post",
        fields: schemaKeys(subscriptionConfirmSchema),
      },
    ])
    expect(surface.scriptOnlyButtons).toEqual([])
    const html = renderToString(node)
    expect(html).toContain(`name="list" value="news"`)
    expect(html).toContain(`name="token" value="token-from-the-link"`)
  })

  it("keeps the form after a failed confirm, so the click can be tried again", () => {
    const surface = noScriptSurface(<SubscriptionConfirmScreen {...props} state="error" />)
    expect(formAt(surface, FORM_ACTIONS.subscribeConfirm).fields)
      .toEqual(schemaKeys(subscriptionConfirmSchema))
  })

  it("offers a new link instead of a form when the link expired, broke or lacks its token", () => {
    for (
      const broken of [{ state: "expired" as const }, { state: "invalid" as const }, { token: "" }]
    ) {
      const surface = noScriptSurface(<SubscriptionConfirmScreen {...props} {...broken} />)
      expect(surface.forms).toEqual([])
      expect(surface.links).toEqual([SCREEN_PATHS.subscribe])
    }
  })

  it("asks nothing more once the subscription is confirmed, and links nowhere unless told", () => {
    const surface = noScriptSurface(<SubscriptionConfirmScreen {...props} state="done" />)
    expect(surface.forms).toEqual([])
    expect(surface.links).toEqual([])
  })

  it("links onward once the subscription is confirmed when given a link", () => {
    const node = (
      <SubscriptionConfirmScreen
        {...props}
        state="done"
        onward={{ href: "/catalog", label: "Back to the catalog" }}
      />
    )
    expect(noScriptSurface(node).links).toEqual(["/catalog"])
    expect(renderToString(node)).toContain("Back to the catalog")
  })
})

describe("UnsubscribeScreen without JavaScript", () => {
  const props = {
    state: "confirm" as const,
    list: "news",
    token: "token-from-the-link",
    error: null,
    pending: false,
  }

  it("posts the link's list and token to the unsubscribe route", () => {
    const node = <UnsubscribeScreen {...props} />
    const surface = noScriptSurface(node)
    expect(surface.forms).toEqual([
      { action: FORM_ACTIONS.unsubscribe, method: "post", fields: schemaKeys(unsubscribeSchema) },
    ])
    expect(surface.scriptOnlyButtons).toEqual([])
    expect(renderToString(node)).toContain(`name="token" value="token-from-the-link"`)
  })

  it("links to subscribing again once the address is removed", () => {
    const surface = noScriptSurface(<UnsubscribeScreen {...props} state="done" />)
    expect(surface.forms).toEqual([])
    expect(surface.links).toEqual([SCREEN_PATHS.subscribe])
  })

  it("shows no form for a link it does not recognise", () => {
    for (const broken of [{ state: "not-recognised" as const }, { token: "" }]) {
      expect(noScriptSurface(<UnsubscribeScreen {...props} {...broken} />).forms).toEqual([])
    }
  })
})

describe("signed-out cards' layout", () => {
  const forms = {
    "sign-in": <AuthScreen {...authDefaults} />,
    "sign-up": <AuthScreen {...authDefaults} screen="sign-up" />,
    "forgot-password": (
      <ForgotPasswordScreen
        email=""
        onEmailChange={() => {}}
        sent={false}
        error={null}
        pending={false}
      />
    ),
    "subscription-confirm": (
      <SubscriptionConfirmScreen
        state="confirm"
        list="news"
        token="t"
        error={null}
        pending={false}
      />
    ),
    "unsubscribe": (
      <UnsubscribeScreen state="confirm" list="news" token="t" error={null} pending={false} />
    ),
    "subscribe": (
      <SubscribeForm
        email=""
        onEmailChange={() => {}}
        list="news"
        sent={false}
        error={null}
        pending={false}
      />
    ),
  }

  it("draws every signed-out form in one card with the same padding and a full-width submit", () => {
    for (const [name, node] of Object.entries(forms)) {
      const html = renderToString(node)
      // The card's body: padded alike everywhere, and every submit button inside spans it.
      const body = html.match(/<div class="([^"]*)">/g)?.find((tag) => tag.includes("p-6 sm:p-8"))
      expect({ name, body }).toEqual({
        name,
        body: `<div class="flex flex-col gap-6 p-6 sm:p-8 [&amp;_button[type=submit]]:w-full">`,
      })
      expect({ name, submits: html.includes(`type="submit"`) }).toEqual({ name, submits: true })
    }
  })

  it("leaves the width to the frame, except the subscribe form the website sets in a wide band", () => {
    for (const [name, node] of Object.entries(forms)) {
      const widths = renderToString(node).match(/\bmax-w-[\w-]+|\bmx-auto\b/g) ?? []
      expect({ name, widths }).toEqual({ name, widths: name === "subscribe" ? ["max-w-md"] : [] })
    }
    const sent = renderToString(
      <SubscribeForm
        email=""
        onEmailChange={() => {}}
        list="news"
        sent
        error={null}
        pending={false}
      />,
    )
    expect(sent.match(/\bmax-w-[\w-]+/g)).toEqual(["max-w-md"])
  })

  it("spans the card with the one way onward when there is nothing to fill in", () => {
    const pages = {
      "signed-in": <AuthScreen {...authDefaults} isSignedIn />,
      "link-sent": (
        <ForgotPasswordScreen
          email=""
          onEmailChange={() => {}}
          sent
          error={null}
          pending={false}
        />
      ),
      "unsubscribed": (
        <UnsubscribeScreen state="done" list="news" token="t" error={null} pending={false} />
      ),
    }
    for (const [name, node] of Object.entries(pages)) {
      const links = renderToString(node).match(/<a\b[^>]*>/g) ?? []
      expect({ name, links: links.length }).toEqual({ name, links: 1 })
      expect({ name, full: /\bw-full\b/.test(links[0] ?? "") }).toEqual({ name, full: true })
    }
  })
})
