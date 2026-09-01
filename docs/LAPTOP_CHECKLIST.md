# Laptop checklist — after merging latest `main`

Use this when you return to your Mac/PC. Your iPhone can keep doing CDD chat with Grok; run these steps on the laptop.

## 1. Pull latest code

```bash
cd /path/to/drag-code-app
git checkout main
git pull origin main
cd frontend && yarn install
```

## 2. One-time Expo / EAS setup (if not done yet)

```bash
cd frontend
yarn eas:login
yarn eas:init
yarn eas:configure
git add app.json && git commit -m "Link Expo EAS project" && git push
```

Optional GitHub CI: add secret `EXPO_TOKEN` at [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens).

## 3. Environment files

```bash
cp backend/.env.example backend/.env   # if needed
cp frontend/.env.example frontend/.env
```

Set `EXPO_PUBLIC_BACKEND_URL` to your API URL (local or deployed). Backend does **not** need an LLM API key.

## 4. Start backend + MongoDB

```bash
docker compose up -d
cd backend && source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

## 5. Build an installable app for your iPhone

```bash
cd frontend
yarn eas:build:preview --platform ios
```

Install from the Expo dashboard link when the build finishes. **EAS Update does not work in Expo Go** — use this build on your phone.

## 6. Push JS-only updates (after builds exist)

```bash
yarn eas:update:preview -- --message "Describe change"
```

Or merge to `main` with `EXPO_TOKEN` set for automatic production OTA.

## 7. Enable AI on the phone

| Platform | Action |
|----------|--------|
| **Web** | Open AI → sign in to Puter when prompted |
| **iOS app (EAS build)** | AI settings (gear) → paste your [OpenRouter](https://openrouter.ai/keys) API key |

## 8. Try Free / Pro limits (dev)

Open the file drawer → **Plan & usage** → use the dev toggle to switch Free/Pro and verify quotas.

---

**Daily dev loop (no rebuild):** `yarn start` in `frontend/` for Expo Go / simulator. Use EAS builds when you want OTA or TestFlight-style installs.
