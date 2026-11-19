# Mobile E2E (Maestro)

Run automated checks **before** `eas build` to avoid wasting build quota.

## Quick verify (no emulator needed)

```bash
cd mobile
npm run verify
```

Runs TypeScript check + all Jest unit tests (~45 tests).

## Full verify with E2E (requires dev build on emulator/device)

1. Install [Maestro](https://maestro.mobile.dev/docs/getting-started/installing-maestro)
2. Start Android emulator and install the dev client (`expo run:android` or latest EAS dev build)
3. Set test account credentials:

```bash
# Windows PowerShell
$env:EMAIL="your-test@example.com"
$env:PASSWORD="your-password"
npm run test:e2e

# macOS/Linux
EMAIL=you@example.com PASSWORD=secret npm run test:e2e
```

Or use the all-in-one script:

```bash
# Windows
set EMAIL=you@example.com
set PASSWORD=secret
npm run verify:all
```

## Flows

| File | What it checks |
|------|----------------|
| `smoke.yaml` | Login + drawer nav to Calendar / Inventory / Shopping / Recipes / Settings / Chat |
| `shopping-add.yaml` | Add shopping item |
| `recipe-add.yaml` | Create recipe in folder |
| `bottom-nav-last-tab.yaml` | Settings via drawer (legacy filename) |

## Pre-build checklist

- [ ] `npm run verify` passes
- [ ] Emulator running with dev build installed
- [ ] `npm run test:e2e` passes with test account


## Guest flows and CI (no account needed)

- `guest-trial.yaml`, `forgot-password.yaml` use the "Try without an account" guest session or only on-device validation, so they need no secrets.
- `delete-account.yaml` (tag `needs-new-backend`) needs the backend with `DELETE /api/auth/account` (migration 0013) on the API the build points at.
- Flows tagged `auth` (`smoke`, `shopping-add`, `recipe-add`, `bottom-nav-last-tab`) need `EMAIL` / `PASSWORD`.
- Run the guest flows locally: `npm run test:e2e:guest`.
- CI (`.github/workflows/mobile.yml`): `verify` (tsc + jest), then `e2e-android` builds a release APK with the JS bundle embedded, boots an Android emulator and runs Maestro. Set repo secrets `E2E_EMAIL` / `E2E_PASSWORD` to also run the `auth` flows; use "Run workflow" with `include_new_backend_flows` once staging has the new backend.
- Maestro only drives Android here. iOS-specific behaviour (keyboard avoidance, iPad full screen) is verified manually on TestFlight.
