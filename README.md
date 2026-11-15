# SafeHer

SafeHer is a safety-planning and emergency-support app. Its practical differentiator is a **trip check-in**: choose a deadline, optionally prepare an ETA and one-time starting-location SMS for a trusted person, and prepare an arrival message when you check in. The message opens in the device's SMS app so the user can review and send it.

The app also provides a safety-readiness check, an SOS button with an offline cellular-SMS draft fallback, user-started audio evidence that police can review, cab-driver/vehicle sharing, trusted contacts, and family/police dashboards.

## What it can and cannot do

- The readiness card checks the app server, server-side contacts, location permission, and configured SMS/voice services. It cannot verify that a person or emergency service will respond.
- SOS creates an incident in the configured SafeHer backend and may request contact notifications. Location updates are attempted while the app is open. **It does not call or dispatch emergency services. Call 112 directly for immediate danger.**
- Without internet, SOS opens a native SMS draft to saved phone contacts with a Google Maps link. The user must tap Send; an offline SOS does not appear on the police dashboard.
- Cab details are sent after explicit confirmation. Direct provider SMS requires internet and `FAST2SMS_API_KEY`; otherwise the native SMS composer is opened.
- Audio is user-started during an active SOS, uploaded to the backend, and viewable by police from incident details. It is not background or covert recording.
- A trip message contains a one-time location pin, not live tracking. Timer expiration is handled only while the timer screen is running or when it is reopened; the app cannot send SOS while closed.
- SMS, voice calls, location, and recording depend on device permissions, network access, and server/provider configuration. Provider acceptance does not guarantee delivery.

Do not rely on this app as the only way to get help. Test on the target device and configure the backend integrations before real use.

## Repository

```text
safeher-backend/   Express, Supabase-backed API, JWT auth, Socket.IO
women-safety/      Expo React Native + TypeScript + Expo Router app
```

## Backend setup

1. Create a Supabase project and run `safeher-backend/supabase/schema.sql`.
2. Copy `safeher-backend/.env.example` to `.env` in `safeher-backend`.
3. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a strong `JWT_SECRET`. Keep the service-role key server-side.
4. Optionally configure `FAST2SMS_API_KEY` and both `EDESY_API_KEY` and `EDESY_AGENT_ID` for SMS and incoming-call requests.

```powershell
Set-Location safeher-backend
npm install
npm test
npm start
```

## App setup

```powershell
Set-Location women-safety
npm install
$env:EXPO_PUBLIC_API_URL="http://YOUR-LAN-IP:3000"
npm run typecheck
npm run lint
npm start
```

The app's `.env.local` may set `EXPO_PUBLIC_API_URL` for local development. A physical phone cannot use the computer's `localhost`; use its LAN IP and allow the backend port through the firewall.

For native modules, install a development build rather than relying on Expo Go:

```powershell
Set-Location women-safety
npm run android
# or build with EAS:
npx eas-cli build --profile development --platform android
npx eas-cli build --profile development --platform ios
npm run start:dev-client
```

Local iOS builds require macOS/Xcode. EAS cloud builds require an Expo account and signing credentials.

From the repository root, `npm start`, `npm run web`, `npm run backend`, and `npm run backend:test` are also available.
