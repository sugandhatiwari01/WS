# SafeHer app

Expo Router app for practical safety planning and emergency support.

## Core flow

- **Safety readiness:** checks server connectivity, trusted contacts, location permission, and configured notification services. A green check is not a guarantee of response.
- **Plan a safe trip:** choose a 5, 10, 15, or 30 minute check-in. Optionally select a trusted contact and prepare a one-time ETA/location SMS in the device's SMS app. If the device cannot confirm that the message was sent, the user confirms before the timer starts.
- **Arrive safely:** stop the timer and optionally prepare an arrival SMS for the same contact.
- **Cab check-in:** share driver, vehicle plate, trip reference, destination, and an optional location pin with trusted contacts. A configured server SMS provider can send directly after confirmation; offline fallback opens the phone's SMS composer.
- **SOS:** start a cancellable countdown, request an incident from the backend, and attempt location updates while the app is open. If internet is unavailable, SafeHer opens a cellular SMS draft with a Google Maps pin for saved trusted contacts.
- **Audio evidence:** while an SOS is active, the user can explicitly start and stop microphone recording. Uploaded recordings are available to police from the incident dashboard.

## Run

```powershell
npm install
$env:EXPO_PUBLIC_API_URL="http://YOUR-LAN-IP:3000"
npm run typecheck
npm run lint
npm run start:dev-client
```

Use the backend's reachable URL for `EXPO_PUBLIC_API_URL`. For a physical phone, do not use the development computer's `localhost`.

## Native development builds

SafeHer uses native Expo modules and should be tested in a development build, not only in Expo Go. Install Android Studio/SDK for local Android builds, or use EAS Build. iOS local builds require macOS and Xcode.

```powershell
# Local native Android build and install
npm run android

# Or create an EAS development build
npx eas-cli build --profile development --platform android
npx eas-cli build --profile development --platform ios
```

After installing the development build on the device, run `npm run start:dev-client` to connect to Metro. EAS build credentials and an Expo account are required for cloud builds.

## Safety limitations

- SafeHer does not call or dispatch emergency services. Call 112 directly for immediate danger.
- The offline SOS fallback cannot create a backend incident or alert the police dashboard. It opens an SMS draft; the user must tap Send. Android cannot confirm SMS delivery.
- Cab details are sent only after the user confirms. If the configured SMS provider is unavailable, the native SMS composer must be used manually.
- Location updates stop when the app is not active; this is not background tracking.
- Trip messages share a one-time starting pin, not live location.
- Check-in timers do not run as a background service. If the app is closed, reopen the timer screen to check an expired deadline.
- Audio is never recorded automatically or in the background. The person using the app starts it during an active SOS; police can play uploaded recordings from incident details.
- SMS and voice-call requests need server credentials and network access. Provider acceptance is not proof of delivery.
- Location, audio, and motion sensors need device permissions. Validate behavior in a development build on the target device before relying on it.
