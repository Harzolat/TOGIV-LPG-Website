# THRONE OF GRACE — PHASE 2.2 LIVE AUTHENTICATION VERIFICATION REPORT

**Verification type:** Verification only (no implementation, no fixes, no config/schema/dependency changes)  
**Date:** Sat Nov 14 2026 (local environment)  
**Workspace:** `/home/harzolat/throne-of-grace-lpg`

## 1. Environment and tools used

| Item | Details |
|---|---|
| Monorepo | `apps/api` (NestJS/Prisma/PostgreSQL), `apps/web` (React customer), `apps/admin` (React admin), `packages/shared`, `packages/ui` |
| Local services (observed running/listening) | API `http://localhost:3000` (`:3000`), Customer web `http://localhost:5175` (`:5175`), Admin web `http://localhost:5176` (`:5176`, `HEAD /` 200), PostgreSQL local instances on `127.0.0.1:5433` (active DB) and `127.0.0.1:5432` |
| Existing configuration | Used as-is (no `.env`/secret/OAuth changes). Read-only inspection confirmed Google OAuth and dev OTP echo configured locally; secret values not exposed. |
| Tools | Playwright MCP/browser tooling (`tools.playwright.browser_navigate/snapshot/take_screenshot/resize`), `curl` (HTTP contract checks), `ss`, `psql` (read-only SELECTs), workspace file inspection/copy into verification folder |
| Read-only DB observation (no writes) | `User`: 5 rows total (1 active staff, 4 deleted customers; no active unverified Google-first customer). `CustomerAuthIdentity`: 0 rows (no linked Google identities). |

**Constraints honored:** no source/API/guard/auth/Prisma/migration/env/OAuth/dependency changes; no fabricated accounts or personal info; no OTP code retrieval/exposure/manual verification; no bypass of CSRF/origin/session/auth guards; no Phase 3 work.

## 2. Google OAuth registration results

| Test | Status | Evidence / notes |
|---|---|---|
| Open customer app, navigate to registration, Continue with Google visible/usable | **PASS** | Playwright snapshots on `http://localhost:5175/register`: registration page loaded with email/password, “Continue with Google”, passkey placeholder, and legacy OTP option visible. |
| Clicking Continue with Google initiates backend Google OAuth start (registration intent) | **PASS** | `GET /api/v1/auth/google/start?intent=register&redirect=/account` (`x-togi-audience: customer`) returned `302` to Google authorization endpoint with `response_type=code`, `scope=openid email profile`, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`, configured `client_id`/`redirect_uri` (values not reproduced). |
| Complete real Google authorization, backend callback, redirect to account-completion for new Google-first customer | **BLOCKED** | No approved Google test account credentials/interactive consent access available in environment; cannot safely complete live Google authorization. Not attempted. |
| `google_pending` cookie attributes (HttpOnly, SameSite=Lax, Secure in prod, path `/api/v1/auth/google/complete`, limited expiry) observed in browser from live callback | **BLOCKED** | Live callback not executed; cannot observe callback-issued cookie in browser. (Implementation/Phase 1.1 contract and negative completion behavior inspected; see security findings.) |
| No pending registration credential in URL; not exposed to frontend JS; completion request sent with credentials | **PASS (partial runtime) / BLOCKED (live callback)** | `/register?oauth=pending` renders completion UI with no token/credential in URL (snapshot: `http://localhost:5175/register?oauth=pending`). Frontend implementation does not read handoff cookie via JS and posts via credentialed API client; live callback-issued cookie flow not executed. |
| Complete registration with approved test account actual info; account/session/redirect; phone-unverified; Google email not phone verification; ordinary requests/claims blocked before phone verification; emergency safety reporting accessible | **BLOCKED** | Depends on live Google-first registration and approved test account; no provisioned Google-first unverified customer available (DB: 0 Google identities). Emergency safety exception is existing backend policy (Phase 1/1.2) but not re-executed end-to-end in this live flow. |

**Summary:** start/intents and pending UI/URL-handling verified; live consent/callback/account creation/cookie issuance and post-registration restrictions not executed.

## 3. Existing Google customer login results

| Test | Status | Evidence / notes |
|---|---|---|
| Sign out, Continue with Google from login, complete authorization, authenticate existing customer | **BLOCKED** | No existing Google-linked customer account in DB and no approved Google test account live consent available. |
| No duplicate customer created; original record intact; info preserved; correct session; no identity conversion | **BLOCKED** | Depends on live login with pre-existing linked Google identity. Implementation inspection shows linked-identity resolution/sign-in path and no-auto-duplicate behavior, but runtime not executed. |
| Login intent initiates backend start correctly | **PASS** | `GET /api/v1/auth/google/start?intent=login&redirect=/account` returned `302` to Google with valid OAuth params (state/nonce/PKCE/code). |

## 4. Phone OTP verification results

| Test | Status | Evidence / notes |
|---|---|---|
| Dashboard shows phone verification requirement for authenticated unverified Google-first customer | **BLOCKED** | No provisioned authenticated Google-first unverified customer available; cannot access account state. (UI implemented in `Account.tsx` per inspection.) |
| Displayed phone belongs to authenticated customer; OTP request targets actual registered phone | **BLOCKED** | Requires authenticated unverified test account/session; not safely executable. |
| OTP verification uses existing backend endpoint/session; invalid/expired OTPs rejected | **BLOCKED** | Not executed (would require OTP handling; OTP codes must not be retrieved/exposed). |
| Successful OTP updates backend state; auth context refresh reflects state; requirement disappears; ordinary requests/claims available only after backend-confirmed verification | **BLOCKED** | Cannot safely complete OTP flow in this environment without exposing/handling OTP codes or bypassing policy; no suitable test account. `OTP_DEV_ECHO` is configured locally, but using/observing dev OTPs would risk exposing codes and was not performed. |

**Summary:** OTP onboarding runtime verification blocked by missing provisioned unverified Google-first account and safe OTP execution constraints.

## 5. Account linking results

| Test | Status | Evidence / notes |
|---|---|---|
| Attempt Google sign-in with matching verified email (unlinked) returns `link_required`; user instructed to authenticate via existing method | **BLOCKED (live) / PASS (UI handling observed)** | Live Google sign-in not executed. Frontend `/login?oauth=link_required` path handled (clear explanation + existing-method sign-in guidance, continuation hint set for explicit linking CTA). Implementation/Phase 1.1 backend preserves no-auto-link on email match. |
| Sign in with existing account, explicit “Link Google account” action appears and requires user initiation | **BLOCKED** | Requires completing sign-in after `link_required` in live flow and authenticated session. UI/flow implemented in `Account.tsx` (explicit button navigates to backend `intent=link` start). |
| Complete Google authorization for linking; confirm successful linking | **BLOCKED** | Requires live Google consent and provisioned matching-email unlinked existing account. |
| Conflict/failure paths (`link_conflict`, `link_failed`) safely testable | **NOT TESTED** | Not attempted without live linked/conflicting identities. Frontend handlers present. |
| No automatic email linking; explicit initiation; correct authenticated session; backend revalidates ownership; cannot link to another customer; no duplicate; existing data intact | **BLOCKED (runtime)** | Runtime not executed. Code inspection: `intent=link` requires authenticated customer session at start and revalidated session ownership at callback; no auto-link; conflict/duplicate protections in backend (read-only review). |

## 6. Session and audience isolation results

| Test | Status | Evidence / notes |
|---|---|---|
| Customer sessions cannot access admin-only endpoints | **BLOCKED** | No authenticated customer session/token obtained in this verification run. |
| Admin sessions cannot be treated as customer sessions | **NOT TESTED** | Not attempted; admin credentials present in env but not used/exposed. |
| Customer logout invalidates relevant session | **BLOCKED** | No authenticated customer session to log out. |
| Expired sessions rejected | **BLOCKED** | No controllable expired-session fixture exercised. |
| Unauthenticated access to protected customer routes redirects appropriately | **PASS** | Playwright: `http://localhost:5175/account` redirected to `http://localhost:5175/login`. |
| Authentication cookies remain HttpOnly | **PASS (partial/indirect)** | No session tokens observed in `localStorage`/`sessionStorage`; completion error response set/cleared `google_pending` with `HttpOnly; SameSite=Lax; Path=/api/v1/auth/google/complete` (observed via `curl`). Live callback-issued session/CSRF cookie attributes not directly inspected in browser. |
| No session tokens in localStorage or sessionStorage | **PASS (observed/inspected)** | No token storage in inspected auth implementation; no auth/session tokens placed in web storage. `sessionStorage['togi_link_google_after_signin']` is a UI continuation hint only (not ownership/auth proof), per implementation and policy. |
| CSRF and origin protection remain active | **PASS (partial)** | API client sends `x-togi-audience: customer` and CSRF double-submit header on mutations; completion endpoint enforces origin/audience and cookie handoff (invalid/missing handoff safely rejected). Full authenticated CSRF/origin negative runtime matrix not executed. |

## 7. Error and recovery results

| Scenario | Status | Evidence / notes |
|---|---|---|
| Google authorization cancelled | **PASS** | UI: `/login?oauth=cancelled` displays “Google sign-in was cancelled…” (screenshot `01-login-oauth-cancelled.png`). Backend callback behavior: `error=access_denied` redirects to `/login?oauth=cancelled` (inspected). |
| Google authorization denied | **PASS (contract/UI equivalent)** | Treated as cancellation in callback (`access_denied` → cancelled) per inspected backend; explicit denied-provider variant not separately reproducible without live Google flow. |
| Invalid or expired OAuth transaction | **PASS (invalid) / BLOCKED (expired real txn)** | `GET /api/v1/auth/google/callback?state=invalid.state&code=invalidcode` → `302 Location: http://localhost:5175/login?oauth=failed` (safe redirect). Expired-but-valid transaction not created/tested. |
| Missing pending-registration cookie | **PASS** | `POST /api/v1/auth/google/complete` (valid JSON body, no cookie, proxied with origin/audience) → `403` “This registration session is invalid or has expired. Please try again.” with cleared `google_pending` cookie. UI shows safe recovery guidance on pending screen. |
| Expired pending-registration cookie | **BLOCKED** | Requires issued pending cookie/record aged past TTL via live callback flow; not safely reproducible without live flow. |
| Reused pending-registration transaction | **BLOCKED** | Requires valid single-use completion then replay; blocked by live-flow dependency. (Backend single-use consumption previously hardened/tested in Phase 1.1; not re-executed live here.) |
| Invalid phone number during registration completion | **PASS (safe handling observed)** | `POST /auth/google/complete` with invalid phone (`"123"`) returned `400` “Invalid registration details.” and cleared `google_pending` cookie (no sensitive leak). (Controller validates body/phone before consuming handoff; response remained safe.) |
| Duplicate phone number | **BLOCKED** | Requires valid pending Google registration completion context; not executable without live callback cookie. |
| Google identity already linked to another account | **BLOCKED** | Requires conflicting linked identities/test accounts and live flow. |
| Failed OTP verification | **BLOCKED** | OTP flow not safely executable (no code exposure). |
| Expired session during account linking | **BLOCKED** | Requires authenticated linking session and controlled expiry. |

## 8. Desktop and mobile observations

| Page/state | Desktop | Mobile (~375x812) | Notes |
|---|---|---|---|
| `/login` | **PASS** (snapshot/screenshot) | **NOT TESTED** (dedicated capture not taken) | Existing form, Google/passkey/OTP options, cancel/fail messages render; responsive classes present. |
| `/register` | **PASS** | **NOT TESTED** | Standard registration form + Google option render. |
| `/register?oauth=pending` | **PASS** | **PASS** (screenshot at 375x812) | Completion form usable/readable; no token in URL; recovery actions present. |
| `/account` (unauthenticated redirect behavior) | **PASS** | **NOT TESTED** | Redirects to `/login`. Authenticated account UI states not verified live. |
| Authenticated phone verification onboarding | **BLOCKED** | **BLOCKED** | Requires authenticated unverified account. |
| Account-linking prompt | **BLOCKED** | **BLOCKED** | Requires `link_required` + authenticated existing-account session. |

**Visual/security checks (observed):** no accidental credential/token exposure seen in UI/snapshots; loading/redirect/error states appropriate in tested cases. Minor dev-console `403` noise from unauthenticated `/auth/me` bootstrap observed (expected auth-check behavior, informational).

## 9. Screenshots and their exact saved locations

Saved in: `/home/harzolat/throne-of-grace-lpg/phase-2.2-live-auth-verification/screenshots/`

| File | Location | State captured |
|---|---|---|
| `01-login-oauth-cancelled.png` | `/home/harzolat/throne-of-grace-lpg/phase-2.2-live-auth-verification/screenshots/01-login-oauth-cancelled.png` | `/login?oauth=cancelled` (desktop) |
| `02-login-oauth-failed.png` | `/home/harzolat/throne-of-grace-lpg/phase-2.2-live-auth-verification/screenshots/02-login-oauth-failed.png` | `/login?oauth=failed` (desktop) |
| `03-register.png` | `/home/harzolat/throne-of-grace-lpg/phase-2.2-live-auth-verification/screenshots/03-register.png` | `/register` (desktop) |
| `04-register-oauth-pending-desktop.png` | `/home/harzolat/throne-of-grace-lpg/phase-2.2-live-auth-verification/screenshots/04-register-oauth-pending-desktop.png` | `/register?oauth=pending` completion (desktop) |
| `05-register-oauth-pending-mobile-375x812.png` | `/home/harzolat/throne-of-grace-lpg/phase-2.2-live-auth-verification/screenshots/05-register-oauth-pending-mobile-375x812.png` | `/register?oauth=pending` completion (mobile 375x812) |

**Not captured (blocked):** authenticated phone verification onboarding, account-linking prompt, live post-callback authenticated account states.

## 10. Security findings classified as Critical, High, Medium, Low or Informational

| Severity | Finding | Status/evidence |
|---|---|---|
| **Critical** | None observed. | No live exploit or bypass executed/identified. |
| **High** | None observed. | — |
| **Medium** | None newly observed in executed checks. | Prior Phase 1.1 hardening (HttpOnly handoff, single-use/expiry, link session revalidation) not fully re-proven in live browser callback flows during this run. |
| **Low** | None observed. | — |
| **Informational** | Unauthenticated `/auth/me` requests produce console `403` errors during page bootstrap (expected unauthenticated state, noisy in dev). | Observed in Playwright console logs on public/auth pages. |
| **Informational** | `sessionStorage['togi_link_google_after_signin']` used as UI continuation hint only; no auth/ownership granted. | Confirmed by implementation inspection; not treated as proof of ownership. |
| **Informational** | Live verification gaps: callback-issued cookie attributes, real OTP verification state transition, and end-to-end link/conflict flows not runtime-verified. | Blocked by unavailable approved Google test accounts/consent and safe OTP/test-account constraints. |

## 11. Blocked tests and reasons

| Area | Blocked items | Reason |
|---|---|---|
| **A. Live Google OAuth registration** | Real Google authorization/consent, callback cookie issuance in browser, account creation/session/redirect, phone-unverified enforcement post-creation, restrictions on ordinary requests/claims for created account | No approved Google test account credentials/interactive access available; cannot complete live Google flow or create approved test user data. |
| **B. Existing Google customer login** | Sign-in as existing linked Google customer, duplicate/identity-preservation checks at runtime | No Google-linked active customer in DB (0 identities) and no live Google consent access. |
| **C. Phone OTP onboarding** | Dashboard prompt on real unverified Google-first account, OTP targeting/invalid-expired-success verification, backend state refresh, gating lift | No provisioned authenticated Google-first unverified test account; OTP codes must not be retrieved/exposed and manual verification bypass prohibited (dev echo exists but not safely usable under constraints). |
| **D. Existing account linking** | Full `link_required` → existing sign-in → explicit link → Google authorization → success/conflict/failure runtime | No approved Google test account + matching unlinked existing verified-email customer pair available for safe live execution. |
| **E. Session/audience isolation** | Customer/admin cross-audience endpoint checks, logout invalidation, expired-session rejection, live cookie attribute inspection for issued sessions | No authenticated customer/admin sessions exercised; no controlled expiry fixture. |
| **F. Error/recovery** | Expired/reused pending transaction, duplicate phone, identity-already-linked conflict, failed/expired OTP, expired session during linking | Depend on live Google callback artifacts, provisioned accounts, or safe OTP/session fixtures not available. |
| **Visual** | Authenticated phone verification onboarding, account-linking prompt screenshots/states | Dependent on blocked authenticated flows. |

## 12. Recommended next steps

1. **Provide approved, non-production test prerequisites** (separately authorized): an approved Google test account with interactive consent access, a provisioned existing customer account with matching verified email (unlinked) for linking tests, and a safe test phone/OTP reception method compliant with policy (no code exposure in reports/logs).
2. **Execute blocked live flows in a controlled session:** complete A–D end-to-end, including browser inspection of callback-issued `google_pending` cookie attributes and successful credentialed completion.
3. **Verify OTP and gating end-to-end:** confirm backend-confirmed `phoneVerifiedAt` update via safe test harness, auth refresh, and that ordinary requests/claims remain blocked until verified while emergency safety reporting remains accessible.
4. **Validate session/audience/CSRF isolation with authenticated fixtures:** logout invalidation, expired-session rejection, and customer-vs-admin audience enforcement (no token leakage to web storage).
5. **Future (separately authorized, smallest improvement):** add minimal automated coverage aligned with repo conventions (e.g. Playwright e2e for OAuth callback-state/redirect/guarded-route flows using test doubles or a test Google project, plus focused API/integration tests for handoff/OTP/link edge cases). Do not treat `vitest run --passWithNoTests` as frontend coverage.

---
**Stop condition:** Verification completed and reported. No code/config/schema/dependency changes made. Phase 3 and automated test implementation not started. Awaiting explicit approval.
