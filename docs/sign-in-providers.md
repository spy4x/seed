# Sign in with Google and GitHub

Both are off until you set their credentials: the sign-in and sign-up pages then show a "Continue
with …" link for each provider that is on, and the profile's "Sign-in and security" section
(`/profile/security`) lists it under "Ways to sign in". A provider is on only when both of its
variables are set in the env file.

| Provider | Where to register                                                         | Variables                                  | Callback URL to register                    |
| -------- | ------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| Google   | Google Cloud console, "APIs & Services", "Credentials", "OAuth client ID" | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `https://<DOMAIN>/api/auth/google/callback` |
| GitHub   | GitHub, "Settings", "Developer settings", "OAuth Apps", "New OAuth App"   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `https://<DOMAIN>/api/auth/github/callback` |

For Google choose the application type "Web application"; the scopes asked for are `openid` and
`email`. GitHub is asked for `read:user` and `user:email`. On your own machine the callback is
`http://app.localhost/api/auth/<provider>/callback`; register it as a second callback URL (Google)
or in a second OAuth App (GitHub allows one callback per app).

What a person gets:

- Someone the provider already signs in here is signed in. An account with an authenticator app is
  still asked for its code.
- Someone new is asked "Create a new account?" first, and nothing is created until they answer.
  The question waits 10 minutes; "I already have an account" creates nothing.
- When an account here already uses that address with a password but never confirmed it, the
  question says so first: creating the new account locks the old one (its password stops working),
  because the provider has proven who owns the address. The old account gets an audit row.
- A provider account joins an existing account by its e-mail address only when both sides have
  verified that address. An address the provider has not verified never links: that person is
  asked whether to create a new account, like anyone unknown.
- A guest ([guest accounts](guests.md)) links a provider on `/keep` without the password step,
  since a guest has none; the provider account then keeps the guest account. One that already
  signs in to another account here offers the choice on `/keep/taken` instead.
- On the profile, a person links and unlinks providers. A provider account links whatever its
  e-mail address, and linking never changes another person's confirmed account; one that already
  signs in to another account here is refused, and the page says so. The last way into an account
  cannot be unlinked; an address another method holds proven counts as a way in, since a sign-in
  link reaches it. Unlinking a method signs out the devices that signed in with it.
  Unlinking asks for the password, or for a provider sign-in of a moment ago when the account has
  none, as linking does. Every link and unlink is mailed to the account's proven address.
- Linking differs from signing up in one case. When the provider has verified an address that
  another account here uses with a password but never confirmed, the link locks that account, as
  creating a new account would, and it gets the same audit row. The person linking is not warned
  first: a link has no question page.
- The sign-in page says how the person last signed in on this browser, with most of the address
  hidden ("Last time you signed in with Google (a\*\*\*@example.com)"), and "Not you? Forget"
  removes it. Only the method's name and the masked address are kept, in the browser's storage,
  and only after a finished sign-in.
- An account made with a provider has no password. It changes its address, sets a first password
  and deletes itself after signing in with its provider again: a provider sign-in less than five
  minutes old stands in for the password, and the dialog links to the provider when there is
  none. Once it has a password it is asked for that, like any other account.
- Linking a provider, and turning two-factor sign-in on, ask for the same proof: the password when
  the account has one, otherwise a provider sign-in less than five minutes old. A first password
  also asks for the authenticator code while two-factor is on.
- A first password, a new address and two-factor sign-in turned on each sign out every other
  device of the account; the device that made the change stays signed in.
