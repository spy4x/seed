import { LegalPage, REPOSITORY_URL } from "../site.tsx"
import { define } from "../utils.ts"

/** What the live demo stores and why, in plain words. A product built on Template adapts it. */
export default define.page(function Privacy({ state }) {
  return (
    <LegalPage
      state={state}
      path="/privacy"
      title="Privacy"
      description={"What the Template demo stores about you, which cookies it sets, and how to have " +
        "your data deleted."}
    >
      <p>
        I'm Anton Shubin, and I run the demo of Template at{" "}
        <a href={state.spaOrigin}>{new URL(state.spaOrigin).host}</a>{" "}
        so you can try it. This page says what the demo keeps about you and why.
      </p>
      <h2>What it stores</h2>
      <ul>
        <li>
          Your account: the username, the password as a salted hash only (never the password
          itself), the e-mail address and the name if you add them, and the second-factor secret if
          you turn it on.
        </li>
        <li>What you create: groups, who is in them, invitations, notes and their tags.</li>
        <li>
          A record of each sign-in, with the time, your IP address and your browser's user agent,
          and a record of changes with the time, so problems and break-ins can be traced.
        </li>
        <li>
          Each device you are signed in on: a device name taken from your browser's user agent, your
          IP address with its last part hidden, and when it was last used. Your profile lists them
          and lets you sign the others out.
        </li>
        <li>
          What the people in your groups see of you: everyone in a group sees your name, your role
          there and the group's notes. The group's owner and its admins also see the address you
          sign in with and when you were last active.
        </li>
        <li>
          A group's activity log: who did what in the group and when. The group's owner and its
          admins can read it.
        </li>
        <li>
          Your notifications inside the app. One you have read is deleted 90 days later.
        </li>
        <li>
          API tokens, if you create any: the name, the group, what the token may do, when it expires
          and when it was last used. The token itself is kept only as a keyed hash, and an expired
          token is deleted 30 days after it expired.
        </li>
        <li>
          Your browser's push address, only if you allow notifications. Turning them off removes it.
        </li>
        <li>Your e-mail address, if you subscribe to the newsletter.</li>
        <li>
          If billing is on and you choose a paid plan, Stripe takes the payment. The demo keeps only
          Stripe's customer and subscription numbers, never your card.
        </li>
      </ul>
      <p>
        Mail, such as sign-in codes, reset links, invitations and the newsletter, goes out through
        an e-mail provider. The servers keep request logs to run and fix the service. If an error
        tracker is set up, the app and the server send it a report when they crash; the app's report
        carries the page's address without anything after the <code>?</code>{" "}
        and without an invitation's token.
      </p>
      <h2>Cookies and your browser</h2>
      <p>
        The demo sets two cookies when you sign in. Signing out removes them; otherwise they last as
        long as the session, two months.
      </p>
      <ul>
        <li>
          A signed session cookie that scripts cannot read. It keeps you signed in.
        </li>
        <li>
          <code>user_id</code>, which holds your account number and which the app's scripts can
          read, so the app knows who is signed in before it asks the server.
        </li>
      </ul>
      <p>
        There are no advertising cookies, no analytics and no tracking. So that the app opens
        without a network, it also keeps in your browser's own storage: who is signed in, a copy of
        your notes and groups, the group you last selected, the position the realtime connection
        reached, so it picks up where it left off, and whether you dismissed the offer to install
        the app.
      </p>
      <h2>What it does not do</h2>
      <p>
        It does not sell your data and shows no ads. Outside the app, your data goes only to the
        providers named above. Inside it, the people in your groups see what is listed above.
      </p>
      <h2>Deleting your data</h2>
      <p>
        You can delete your account from your profile in the app. It asks for your password, and for
        your authenticator code if the second factor is on. The account is hidden at once and
        deleted for good 7 days later; signing in during those 7 days brings it back. A group you
        own that other people still use, or a paid plan that is not cancelled, stops the deletion
        until you hand the group over or cancel the plan.
      </p>
      <p>
        Deleting the account removes the groups you own with their notes, your sessions, your
        profile and settings, and your push addresses. What you wrote in a group someone else owns
        stays there, shown as written by "Deleted user". To leave the newsletter, use the
        unsubscribe link in any of its mails.
      </p>
      <p>
        There is no way to download your data from the app yet. To get a copy, write to me through
        {" "}
        <a href="https://antonshubin.com">antonshubin.com</a>. Do not keep anything important in the
        demo: it is a demo, and its data may be reset.
      </p>
      <h2>Questions</h2>
      <p>
        Ask through <a href="https://antonshubin.com">antonshubin.com</a> or{" "}
        <a href={`${REPOSITORY_URL}/issues`}>an issue on GitHub</a>.
      </p>
    </LegalPage>
  )
})
