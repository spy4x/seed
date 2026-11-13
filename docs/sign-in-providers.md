# Sign in with Google and GitHub

> Also on the website: [seedsaas.com/docs/sign-in-providers](https://seedsaas.com/docs/sign-in-providers).

This page turns on "Continue with Google" and "Continue with GitHub" and says what a person gets
from them.

Both providers are off until you give them their credentials. A provider is on only when both of
its variables are set. It then shows on the sign-in and sign-up pages, and under "Ways to sign in"
on the profile's "Sign-in and security" page (`/profile/security`).

**You need:**

- the app's host, the `DOMAIN` of your env file, such as `app.example.com`;
- a Google account, a GitHub account, or both.

## Register with Google

1. Open the [Google Cloud console](https://console.cloud.google.com) and pick or create a project.
2. Go to "APIs & Services", then "Credentials".
3. Choose "Create credentials", then "OAuth client ID".
4. Set the application type to "Web application".
5. Under "Authorized redirect URIs", add this address, with your `DOMAIN` in place of `<DOMAIN>`:

   ```text
   https://<DOMAIN>/api/auth/google/callback
   ```

6. For your own machine, add a second redirect URI:

   ```text
   http://app.localhost/api/auth/google/callback
   ```

7. Create the client. Copy its client ID and client secret into the env file:

   ```sh
   GOOGLE_CLIENT_ID=<client ID>
   GOOGLE_CLIENT_SECRET=<client secret>
   ```

Seed asks Google for the scopes `openid` and `email` only.

## Register with GitHub

1. On GitHub, open "Settings", then "Developer settings", then "OAuth Apps".
2. Choose "New OAuth App".
3. Set "Homepage URL" to `https://<DOMAIN>`.
4. Set "Authorization callback URL" to:

   ```text
   https://<DOMAIN>/api/auth/github/callback
   ```

5. Register the app, then choose "Generate a new client secret".
6. Copy the client ID and the secret into the env file:

   ```sh
   GITHUB_CLIENT_ID=<client ID>
   GITHUB_CLIENT_SECRET=<client secret>
   ```

A GitHub OAuth App has one callback URL. For your own machine, register a second OAuth App with
`http://app.localhost/api/auth/github/callback` and put its pair in your local env file. Seed asks
GitHub for the scopes `read:user` and `user:email`.

## Settings

The env file is `infra/envs/.env` on your machine and `infra/envs/.env.prod` on the server. Deploy
after you change it.

| Variable               | What it does                                    | Default |
| ---------------------- | ----------------------------------------------- | ------- |
| `GOOGLE_CLIENT_ID`     | Google's client ID. Google is on when both set. | empty   |
| `GOOGLE_CLIENT_SECRET` | Google's client secret.                         | empty   |
| `GITHUB_CLIENT_ID`     | GitHub's client ID. GitHub is on when both set. | empty   |
| `GITHUB_CLIENT_SECRET` | GitHub's client secret.                         | empty   |

While a provider is off, its button is hidden. Its sign-in link sends the person back to the
sign-in page with "That sign-in did not work. Try again.", and linking it on the profile answers
404.

## Signing in and signing up

- **A known person** is signed in. An account with an authenticator app is still asked for its
  code.
- **A new person** is asked "Create a new account?" first. Nothing is created until they answer.
  The question waits 10 minutes, and "I already have an account" creates nothing.
- **An existing account joins by e-mail address** only when both sides have verified that address.
  An address the provider has not verified never links: that person is asked the new-account
  question.
- **An unconfirmed password account** with the same address loses its password when the new
  account is created, because the provider has proven who owns the address. The question warns
  about this first, and the old account gets an audit row.
- **With `SIGN_UP=invite`** ([who may sign up](deploy.md#who-may-sign-up)), "Create a new
  account?" makes the account only with an invitation. An invitation tied to an address admits it
  only when the provider has verified that address; a link invitation admits any. Without one, the
  answer is `SIGN_UP_CLOSED` and nothing is created. A known person still signs in.
- **A guest** ([guest accounts](guests.md)) links a provider on `/keep` without a password step.
  If that provider account already signs in to another account here, `/keep/taken` offers the
  choice instead.

The sign-in page remembers how the person last signed in on this browser, with most of the address
hidden: "Last time you signed in with Google (a\*\*\*@example.com)". "Not you? Forget" removes it.
Only the method's name and the masked address are kept, in the browser's storage, after a finished
sign-in.

## Linking and unlinking on the profile

- A person links a provider account whatever its e-mail address. Linking never changes another
  person's confirmed account.
- A provider account that already signs in to another account here is refused, and the page says
  so.
- Linking and unlinking ask for the password. An account without one is asked for a provider
  sign-in less than five minutes old instead.
- The last way into an account cannot be unlinked. An address another method holds proven counts
  as a way in, since a sign-in code mailed to it gets in.
- Unlinking a method signs out the devices that signed in with it.
- Every link and unlink is mailed to the account's proven address.

Linking differs from signing up in one case. When the provider has verified an address that an
unconfirmed password account here uses, the link locks that account and writes the same audit row.
The person linking is not warned first, because a link has no question page.

## Accounts without a password

An account made with a provider has no password. A provider sign-in less than five minutes old
stands in for it. With it, the person can:

- change their e-mail address;
- set a first password, which also asks for the authenticator code while two-factor sign-in is on;
- turn on two-factor sign-in;
- delete the account.

When the sign-in is older, the dialog links to the provider. Once the account has a password, it
is asked for that, like any other account.

A first password, a new address and turning on two-factor sign-in each sign out every other device
of the account. The device that made the change stays signed in.

## Next

- [Guest accounts](guests.md): how a guest keeps the account with a provider.
- [Deploy and operate](deploy.md): deploy after you set the variables.
