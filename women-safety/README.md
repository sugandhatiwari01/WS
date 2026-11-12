# SafeHer app

Expo Router app for practical safety planning and emergency support.

## Core flow

- **Safety readiness:** checks server connectivity, trusted contacts, location permission, and configured notification services. A green check is not a guarantee of response.
- **Plan a safe trip:** choose a 5, 10, 15, or 30 minute check-in. Optionally select a trusted contact and prepare a one-time ETA/location SMS in the device's SMS app. If the device cannot confirm that the message was sent, the user confirms before the timer starts.
- **Arrive safely:** stop the timer and optionally prepare an arrival SMS for the same contact.
- **SOS:** start a cancellable countdown, request an incident from the backend, and attempt location updates while the app is open. Family/police screens and notifications require a reachable, configured backend.

## Run

```powershell
npm install
$env:EXPO_PUBLIC_API_URL="http://YOUR-LAN-IP:3000"
npm run typecheck
npm run lint
npx expo start
```

Use the backend's reachable URL for `EXPO_PUBLIC_API_URL`. For a physical phone, do not use the development computer's `localhost`.

## Safety limitations

- SafeHer does not call or dispatch emergency services. Call 112 directly for immediate danger.
- Location updates stop when the app is not active; this is not background tracking.
- Trip messages share a one-time starting pin, not live location.
- Check-in timers do not run as a background service. If the app is closed, reopen the timer screen to check an expired deadline.
- SMS and voice-call requests need server credentials and network access. An accepted request is not proof of delivery.
- Location, audio, and motion sensors need device permissions. Validate behavior in a development build on the target device before relying on it.
