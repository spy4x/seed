# The Android app

This page shows how to build the Android app, make it the product's own and publish it on Google
Play.

The app (`apps/android`) is a [Capacitor](https://capacitorjs.com) 8 wrapper around the SPA. It
does not carry the SPA's files: it opens the hosted SPA by its address (`server.url` in
`apps/android/capacitor.config.json`), as a browser would. Sign-in keeps its first-party cookies,
so the API needs no change for the app, and every deploy of the SPA reaches the app at once,
without a store update. When the address cannot load, the app shows `apps/android/www/index.html`,
a page that offers to try again.

The native project in `apps/android/android` was made by `cap add android` and is committed, as
Capacitor recommends. Capacitor's packages are pinned in `apps/android/package.json`, with a
lockfile of their own, so they stay out of the root workspace.

## Build a test APK

```sh
deno task android:build
```

It installs Capacitor's packages, copies the config into the native project (`cap sync android`)
and builds a debug APK, then prints its path:
`apps/android/android/app/build/outputs/apk/debug/app-debug.apk`. A debug APK installs on any
phone with developer options on (`adb install -r <path>`), and never goes to the store.

The task needs JDK 21 and the Android SDK with platform 36 and build-tools 36.0.0, found through
`ANDROID_HOME`. Android Studio installs both. Without them, run the task in the image CI uses,
which has both; this line mounts your Deno into it and runs as you, so the files it writes stay
yours:

```sh
docker run --rm --security-opt label=disable --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD":/repo -w /repo -v "$(command -v deno)":/usr/local/bin/deno:ro \
  ghcr.io/cirruslabs/android-sdk:36@sha256:f9b3ea9ed2b5fc9522adae82c7b4622ab7aa54207ef532c8e615a347dca08f31 \
  deno task android:build
```

Run it from the repository's root, on Linux (the mounted Deno is a Linux binary).
`--security-opt label=disable` lets the container run the mounted Deno on a host with SELinux, such
as Fedora; elsewhere it changes nothing. The first build downloads Gradle and the libraries, about
two minutes.

CI builds the same APK in its `android` step ([CI setup](woodpecker-ci-setup.md)) on every push to
`main`, and on a pull request that changes `apps/android`, `deno.jsonc` or `.woodpecker/ci.yml`.
CI signs nothing and keeps no APK.

## Make it the product's app

| What                                      | Where                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The address it opens                      | `server.url` in `apps/android/capacitor.config.json`: `https://` and the product's `DOMAIN`    |
| The app id, which Play knows the app by   | `appId` in `capacitor.config.json` and `applicationId` in `apps/android/android/app/build.gradle` |
| The name under the icon                   | `appName` in `capacitor.config.json`, `app_name` and `title_activity_main` in `apps/android/android/app/src/main/res/values/strings.xml` |
| The version                               | `versionCode` and `versionName` in `app/build.gradle`; every upload needs a higher `versionCode` |
| The icon                                  | `apps/android/android/app/src/main/res/mipmap-*/` (below)                                      |
| The splash screen                         | `apps/android/android/app/src/main/res/drawable*/splash.png`                                   |

Choose the app id once, in reverse-domain form (`com.example.app`): Play never lets an app change
it after the first upload. The `namespace` in `build.gradle` and the Java package of
`MainActivity` may keep Seed's `com.seedsaas.app`; they are internal names, and keeping them lets
later syncs from Seed apply cleanly. Capacitor writes `appId` and `appName` into the native project
only at `cap add`, so change the native files too, as the table says.

**The icon.** Open `apps/android/android` in Android Studio, right-click `app/src/main/res`, and
choose New → Image Asset. Pick "Launcher Icons (Adaptive and Legacy)", the product's logo as the
foreground layer and its brand colour as the background, and keep the name `ic_launcher`. Android
Studio rewrites every `mipmap-*` folder and `values/ic_launcher_background.xml`.

## Publish on Google Play

CI builds only the debug APK. A release is signed and uploaded by hand, so the signing key never
reaches CI or the repository.

1. Create a [Google Play developer account](https://play.google.com/console/signup). It costs a
   one-time fee of $25.
2. Make an upload key, once, and keep it outside the repository, with a backup. Without it you
   cannot publish an update until Google resets it:

   ```sh
   keytool -genkeypair -v -keystore ~/keys/<product>-upload.jks -alias upload \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

3. Raise `versionCode` in `app/build.gradle`, then build the release bundle and sign it.
   `jarsigner` asks for the key's password, so it stays out of your shell history:

   ```sh
   deno task android:build  # syncs the config into the native project
   cd apps/android/android && ./gradlew bundleRelease --no-daemon
   jarsigner -keystore ~/keys/<product>-upload.jks \
     app/build/outputs/bundle/release/app-release.aab upload
   ```

4. In Play Console, create the app, fill in the store listing, the content rating, the data
   safety form and the privacy policy's address (the website's `/privacy`), and turn on Play App
   Signing: Google keeps the key the phones check, and your key only proves an upload is yours.
5. Upload `app-release.aab` to the internal testing track first, install it from there, and sign
   in. Play Console lists what a new account must do before production, such as a closed test.

## Known gaps

- **Sign-in with Google, GitHub or a passkey does not work in the app.** Capacitor opens any other
  host in the phone's browser, so the provider's page and the cookie it leads to end up there, not
  in the app. Google also refuses its sign-in inside an embedded webview. Passkeys are not turned
  on in the app's webview. The app supports sign-in with a password and with an email code.
- **Offline is what the SPA's service worker already keeps.** The first start needs the network;
  after that the app opens what the hosted SPA cached ([Offline in the SPA](offline.md)).
- **No push notifications.** The app shows the SPA's live updates while it is open.
- **Play may refuse a wrapper.** Google Play rejects apps that only show a website. If it refuses
  this one, the next step is to ship the SPA's files inside the app, which needs sign-in without
  cookies first ([#202](https://github.com/spy4x/seed/issues/202)).

## Next

- [Start a product](start-a-product.md): everything else a product renames.
- [CI setup](woodpecker-ci-setup.md): the `android` step among the others.
