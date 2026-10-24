# Android signing and update-channel review

Scope: the native project at `D:\Learniq\mobile` (outside this repository). Findings come from read-only copies of
`android/app/build.gradle`, `app.json` and the keystore file's metadata. No key material is stored here.

## Findings

| # | Finding | Evidence | Severity / status |
|---|---------|----------|-------------------|
| A-1 | The **release** build type is signed with the `debug` signing config, which points at the template `debug.keystore` | `build.gradle`: `release { signingConfig signingConfigs.debug }`; installed APK certificate is `CN=Android Debug` | High - confirmed |
| A-1b | The keystore password and key alias are the public React Native / Expo template values, written in plain text in `build.gradle` | `signingConfigs.debug` block | High - anyone can build an APK the installed app accepts as an update |
| A-2 | `expo-updates` appears in the built manifest (`expo.modules.updates.ENABLED`), but `app.json` defines no update URL, no `runtimeVersion` and no code-signing certificate, so the app has nothing to fetch updates from. **Not yet proven** against the built manifest | `app.json` has no `updates` / `runtimeVersion` | Needs verification: inspect the built manifest for `expo.modules.updates.EXPO_UPDATE_URL`; if absent, set `ENABLED=false` explicitly |
| A-3 | `allowBackup` is `false` | `app.json` `android.allowBackup: false` | OK |
| A-4 | Dangerous permissions limited to camera and microphone (live classes, proctoring); storage, location, contacts and overlay are blocked | `app.json` | OK |
| A-5 | Not assessed: cleartext traffic setting, token storage on the device, R8/minify configuration (`minifyEnabled` follows a Gradle property), native dependency audit | - | Open |

Release certificate SHA-256 of the currently installed app (unchanged by this work):
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`

## Why nothing was changed automatically

Android only accepts an update signed by the same certificate as the installed app. Replacing the signing key
makes every existing install unable to update in place: users would have to uninstall and reinstall, losing local state.
That is an owner decision, so no signing identity, package name or keystore was changed or generated here.

## Options (owner decision)

1. **Keep the identity, stop publishing the template password (minimum).** Move the passwords out of `build.gradle`
   into `~/.gradle/gradle.properties` or environment variables (`LEARNIQ_STORE_PASSWORD` etc.). This does not fix A-2,
   because the password is public and the key is the template key, but it stops advertising it.
2. **Migrate to a private release key (recommended).** Generate a new keystore offline, back it up in two places,
   enrol the app in Play App Signing, and use Google's key-rotation (APK Signature Scheme v3 lineage) so existing
   installs can still update. Without Play distribution (sideloaded APK from the website) the only path is a
   v3 rotation signed by the old key plus the new key (`apksigner rotate`), which needs the old keystore.
3. **Do nothing and accept the risk** until a Play Store release exists.

## Proposed (not applied) `build.gradle` shape for option 2

```gradle
signingConfigs {
    release {
        storeFile file(System.getenv("LEARNIQ_KEYSTORE") ?: "release.keystore")
        storePassword System.getenv("LEARNIQ_STORE_PASSWORD")
        keyAlias System.getenv("LEARNIQ_KEY_ALIAS")
        keyPassword System.getenv("LEARNIQ_KEY_PASSWORD")
    }
}
buildTypes {
    release { signingConfig signingConfigs.release }
}
```

Rules: never commit the keystore or passwords; add `*.keystore` and `*.jks` to `.gitignore` of the mobile project;
verify the signature of every release with `apksigner verify --print-certs` before publishing.

## Verification before any release

- `apksigner verify --print-certs app-release.apk` shows the expected SHA-256.
- Install over the previous release (`adb install -r`) succeeds without uninstalling.
- Keep the previous APK as a backup.
