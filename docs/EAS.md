# EAS Build & Update (Expo)

This app is configured for **EAS Build** (installable binaries) and **EAS Update** (OTA JS/asset updates).

> **Important:** EAS Update does **not** apply to Expo Go. You need a custom build (development, preview, or production) that includes `expo-updates`. Use Expo Go only for day-to-day coding; use EAS when you want teammates or testers to get updates without rebuilding native code every time.

## One-time setup (you must do this locally)

These commands need your Expo account — they cannot be finished in CI until you create a project.

```bash
cd frontend
yarn install

# 1. Log in (opens browser)
npx eas-cli login

# 2. Link this folder to an Expo project (creates projectId)
npx eas-cli init

# 3. Write updates.url + projectId into app.json
npx eas-cli update:configure
```

`eas init` / `update:configure` will replace the `REPLACE_WITH_EAS_PROJECT_ID` and `REPLACE_WITH_EXPO_USERNAME` placeholders in `app.json`. Commit those changes.

### Optional: CI token

1. Create an access token at [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens)
2. In GitHub → repo **Settings → Secrets and variables → Actions**, add:
   - Name: `EXPO_TOKEN`
   - Value: the token

The workflow `.github/workflows/eas-update.yml` publishes an OTA update to the `production` channel on every push to `main` that touches `frontend/`.

## Profiles (`eas.json`)

| Profile | Purpose | Channel |
|---------|---------|---------|
| `development` | Dev client with hot reload | `development` |
| `preview` | Internal test APK/IPA | `preview` |
| `production` | Store / public release | `production` |

## Build an installable app

```bash
cd frontend

# Android APK for testers (QR / download link)
npx eas-cli build --profile preview --platform android

# iOS (needs Apple Developer account)
npx eas-cli build --profile preview --platform ios

# Both store-ready binaries
npx eas-cli build --profile production --platform all
```

Install from the Expo dashboard link when the build finishes.

## Push an OTA update (no new store binary)

Use this after JS-only changes (screens, Puter/OpenRouter AI, styles, etc.). Native changes (new native modules, `app.json` plugins, SDK bumps) need a **new EAS Build**.

```bash
cd frontend

# Testers on the preview build
npx eas-cli update --channel preview --message "Describe the change"

# Users on the production build
npx eas-cli update --channel production --message "Describe the change"
```

Devices check for updates on launch (`checkAutomatically: ON_LOAD`). Force-quit and reopen the app to pick up a new update.

## Local day-to-day development (unchanged)

```bash
cd frontend
yarn start
```

Expo Go / simulators still work for local work. EAS is for shared builds and OTA.

## Environment variables on builds

Set `EXPO_PUBLIC_BACKEND_URL` for cloud builds (EAS secrets or profile `env`):

```bash
cd frontend
npx eas-cli secret:create --name EXPO_PUBLIC_BACKEND_URL --value https://your-api.example.com --scope project
```

Or add under a profile in `eas.json`:

```json
"preview": {
  "channel": "preview",
  "env": {
    "EXPO_PUBLIC_BACKEND_URL": "https://your-api.example.com"
  }
}
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Update never appears | Confirm the install was an **EAS build**, not Expo Go; same `runtimeVersion` / app `version` |
| `projectId` errors | Run `npx eas-cli init` and commit `app.json` |
| Native module missing after update | Rebuild with `eas build` — OTA cannot ship new native code |
| CI workflow skipped / failed | Ensure `EXPO_TOKEN` secret exists and placeholders in `app.json` were replaced |
