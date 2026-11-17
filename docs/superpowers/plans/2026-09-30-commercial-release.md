# Commercial release implementation plan

**Goal:** Prepare FizLab subscriptions, account recovery and Android release configuration.

**Architecture:** Keep the existing Capacitor application and D1-compatible account API. Use Google Play through RevenueCat with server verification, plus Resend one-time email codes. No provider credentials or fake purchases in the client.

**Tech Stack:** React 19, TypeScript, Capacitor 8, RevenueCat Capacitor 13.6.1, Node 24 / Cloudflare D1.

**Spec:** `docs/superpowers/specs/2026-09-30-commercial-release-design.md`.

## Work packages

- [x] Server billing: `server/billing.mjs`, worker routing, durable provider-deletion queue and `server/billing.test.mjs`. Test revocation, expiry, sandbox rejection, forged client state and provider failure.
- [x] Account reliability: email module, verification/reset/change-password endpoints and UI; test one-time use, expiry, enumeration resistance and concurrent password resets.
- [x] Native purchasing: `src/lib/billing.ts`, official SDK, account identity serialization, base-plan pricing and Android release/signing configuration.
- [x] Subscription UI: provider keyed by user, subscription page, terms, navigation and premium-topic loading gate; test guest/free/paid/failure states.
- [x] Release integration: server environment forwarding and packaging, privacy copy, deployment/setup instructions and configuration checks.
- [x] Run lint, TypeScript, isolated tests, build and browser regressions. Report exact external release requirements and untested native/store flows.

External setup and publication remain pending; see `docs/release-status.md`. The code/test work above does not constitute publication or a real Google Play transaction.

## Review focus

Never retain entitlement after switching accounts. Do not treat pending/cancelled purchase as payment. Cancelled renewal retains paid access until expiry. Never advertise a price or trial different from the actual purchase option. Deleted accounts must not leave untracked provider data. Preserve all unrelated existing working-tree changes.
