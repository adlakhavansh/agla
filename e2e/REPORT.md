# Browser end-to-end test report

Tested on 27 October 2026, using Chromium at `/usr/bin/chromium`, API port 8090, client port 5190 and MongoDB port 27018. All browser fixtures, seeding and direct database checks used `agla_e2e`. The existing API test uses its own in-memory MongoDB. No git write commands were run.

## Bugs fixed

Locations refer to the final files. Each fix has an assertion that fails with the original behavior.

| Location | Scenario and fix | Regression |
| --- | --- | --- |
| `client/src/pages/Menu.jsx:265` | A live sell-out or removal left unavailable items in the saved cart; removed dishes could leave a ghost mobile count. Reconcile cart lines and quantities with the current menu and persist the result. Keep a checkout error visible even if reconciliation empties the cart (`Menu.jsx:167`). | `e2e/browser.mjs:237` and `:366`: sell-out/removal clears the cart and mobile count; a losing checkout still shows its reason. |
| `client/src/pages/Menu.jsx:246` | A menu rejoined its socket room after reconnecting without fetching stock/slot changes missed while disconnected. Refresh when reconnecting. | `e2e/browser.mjs:226`: disconnect the student's socket, sell out a dish, reconnect and assert the menu catches up. |
| `client/src/pages/Kitchen.jsx:278` | Removing staff evicted their socket room but left the cached board and its controls visible. Treat a failed access recheck as denied, clear orders and render the access-denied screen. | `e2e/browser.mjs:383`: an already-open board disappears after removal; the removed socket receives no subsequent order. |
| `client/src/pages/Kitchen.jsx:178` | An open stock panel only heard manual stock changes; new reservations and cancellations left its plate counts stale. Subscribe to the public menu room and refresh on stock-affecting menu events/reconnects. | `e2e/browser.mjs:249`: order and cancel while the panel stays open; assert both count changes without reload. |
| `client/src/store/authSlice.js:36` | Every successful session probe tore down the live socket, including duplicate checks under React StrictMode. This caused connection churn and intermittent “WebSocket is already in CLOSING or CLOSED state” console errors. Reconnect when the user changes; otherwise reuse the active connection. | `e2e/browser.mjs:171`: concurrent probes of the same session preserve the connected socket ID. |
| `server/utils/reserve.js:58` | A checkout could reserve the last plate, lose a full slot, return the plate and leave `soldOutAt` set. The prep plan learned a phantom sell-out. Clear natural sell-out history atomically when returned stock is available, preserving manual closures. | `server/test.js:167`: full-slot rollback returns the last plate and clears the timestamp; cancelling a natural last-plate order also clears it. Existing manual-closure cancellation checks still pass. |
| `server/utils/orders.js:48` | A kitchen cancellation broadcast the cancelled order before starting its refund. If the provider failed, the student's live ticket never heard `refund_pending`. Broadcast the atomic pending-refund update before attempting the provider call. | `server/test.js:293`: student socket hears pending refund despite provider failure. Browser also checks a staged paid-online ticket updates live and persists on reload. |
| `server/controllers/plan.controller.js:69` | A new dish inherited zero sales from trading days before it existed, potentially suggesting zero prep despite having no history. Exclude those days while retaining actual seeded/imported historical stock rows. | `server/test.js:332`: a new dish has no historical samples and no suggestion; established demo history remains usable. |

Original implementations were temporarily restored and checked for the stock rollback, pending-refund event, new-dish history and repeated-session regressions: each failed at its new assertion. The initial browser run reproduced the stale cart, and a separate run reproduced the open stock-panel failure before its fix. All temporary restorations were undone before the final checks.

## Browser coverage

One headless browser, five isolated contexts: demo student, registered second student, kitchen, owner and registered invitee. User workflows are driven through the real UI. Direct MongoDB writes are limited to isolated fixture preparation: trading hours, the final available plate, slot capacity, no-shows and online-payment ticket states. The two races delay actual browser requests and release them against the real API; no success/error responses are mocked.

The suite covers landing canvas/hero/story/proof, canteens, 404, account validation/login/logout/demo chips, protected-route and cart login detours, menu sections/veg/stock/quantity limits, persisted cart, disabled full/past slots, counter checkout, ticket token/code/progress, live kitchen transitions, the ready overlay, wrong/right collection codes, both cancellation flows, live sell-out/restock, stock counts, pause/resume, last-plate and slot-capacity races, all report ranges and chart-table toggles, prep risks/day changes/save/reload, menu CRUD/validation, invitations/role changes/removal/decline/cancel, hours validation/save, every kitchen-to-manager route restriction, student staff denial, history, foreign-order denial, awaiting-payment/no-show/refund ticket branches, and new-canteen empty states.

At 390×844 it checks document width on landing, menu with cart open, ticket, kitchen, reports with data loaded, and the ready overlay. Successful screenshots are in `output/playwright/`. Socket frames assert that the kitchen never gets pickup codes, the other student never gets the first student's order, and removed staff never get later orders. Unexpected page exceptions, console errors and HTTP failures fail the run; deliberately provoked validation/access responses and logged-out authentication probes are explicitly expected.

## Accounting and time checks

Every report range was reconciled against raw MongoDB data for 26 October. The browser checked order count, money, no-shows, cancellations, cooked/on-time counts, leftover plates and leftover cost. Observed values:

```json
{
  "day": "2026-10-26",
  "orders": 287,
  "revenuePaise": 1718500,
  "noShows": 8,
  "cancelled": 11,
  "cooked": 276,
  "onTime": 232,
  "leftoverPlates": 18,
  "leftoverCostPaise": 33500
}
```

That is ₹17,185 taken and ₹335 of leftovers at cost. The range totals also equal the sum of their daily rows. Today's stock `sold` counts and slot occupancy were checked against all non-cancelled raw orders after the races and cancellations.

`server/test.js:54` additionally checks the 18:30 UTC IST date rollover, midnight round-trip, last slots ending by closing time, full-slot rejection and the end-of-day lead-time boundary with explicit fixed timestamps.

## Documented trade-offs preserved

- `server/utils/time.js:1`: every canteen uses fixed IST (+05:30).
- `server/controllers/canteen.controller.js:129`: changing the slot grid retains already-booked slots even if the new grid no longer offers them.
- `server/utils/sweeper.js:36`: after the payment-provider check gives up, a later capture can require a manual refund; webhooks are the documented future remedy.

## Limits

Real Razorpay Checkout, UPI/card payment, capture and settled refunds could not be exercised without keys. The browser checks that unavailable online checkout is hidden, counter-blocked students get a clear message, and staged awaiting/refund ticket branches work. The API suite covers signed/forged/late payment results and failed refund retries using dummy keys. Headless Chromium cannot establish physical phone vibration, audible output or OS-level notification delivery; the actual ready overlay and notification code run without browser errors. A live browser session across IST midnight was not performed; fixed-time API assertions cover date and slot boundaries. The browser suite requires at least 40 minutes remaining in the IST day. No load testing was performed.

A pre-existing React Redux development warning about the empty-cart selector returning a fresh object remains; it is a warning, and no unexpected console errors remained in the final run.

## Files changed

- `README.md`: Browser end-to-end test subsection and isolated run instructions.
- `e2e/browser.mjs`: runnable browser suite, fixtures, assertions, screenshots and cleanup in `finally`.
- `e2e/REPORT.md`: this report.
- `client/src/pages/Menu.jsx`: cart reconciliation, empty-cart checkout error, reconnect refresh.
- `client/src/pages/Kitchen.jsx`: live stock-panel counts and revoked-access handling.
- `client/src/store/authSlice.js`: preserve the live socket on unchanged session checks.
- `server/utils/reserve.js`: reservation rollback sell-out history.
- `server/utils/orders.js`: live pending-refund event.
- `server/controllers/plan.controller.js`: new-dish history filter.
- `server/test.js`: regression assertions, IST/slot boundaries and child PID logging.

Generated artifacts: `output/playwright/{landing,menu,ticket,ready,kitchen,reports}.png`; ignored production artifacts under `client/dist/` from the required build. Failure-only screenshots/text were removed after the successful run. No dependency manifests or lockfiles changed.

## Final command outputs

All four commands exited with code 0. Authentication/refund-provider errors in the API log are expected branches tested with dummy Razorpay keys.

### `cd server && npm test`

```text
> agla-server@1.0.0 test
> node test.js

Test process PIDs: API 97, MongoDB 36, MongoDB guardian 37
✓ IST midnight rollover, closing-time slots, lead time and full-slot boundaries
✓ accounts: register, duplicate email, wrong password, logged-out access
✓ owner: create canteen, settings validation, menu items
✓ team: invite, accept once, kitchen role limits
✓ student: public menu with stock left and slots
✓ ordering: validation, idempotent retry, last-plate race, slot capacity
✓ cancel: only the owner, releases the slot, only once
✓ kitchen: board without codes, one move per tap, live ready event, code check at pickup
✓ kitchen: owner can cook and collect their own order
✓ kitchen: cancel with reason, manual sold-out survives cancellation, restock, pause orders
✓ sweeper: uncollected food becomes a no-show; two no-shows → pay online only
Razorpay order failed: Authentication failed
Refund for order 6ae08c9f3b19f5e5515bb2a9 failed, will retry: {"statusCode":404}
Refund for order 6ae08c9f3b19f5e5515bb2aa failed, will retry: {"statusCode":404}
✓ payments: start failure releases, forged signature refused, cancel refunds, late payment refunded
Refund for order 6ae08c9f3b19f5e5515bb2a9 failed, will retry: {"statusCode":404}
Refund for order 6ae08c9f3b19f5e5515bb2aa failed, will retry: {"statusCode":404}
✓ sweeper: unpaid checkout expires; internal endpoint needs the secret
✓ prep plan from history, plan validation, report
✓ my orders: history, awaiting payment, privacy

All Agla workflows passed
```

### `node server/utils/forecast.check.js`

```text
forecast checks passed
```

### `node e2e/browser.mjs`

```text
Chromium PIDs started: browser:14, GPU:42, network.mojom.NetworkService:45, storage.mojom.StorageService:60
✓ landing LED, hero, story, proof; canteen list; 404; phone landing
✓ registration validation/duplicate, login errors, logout, return to protected route, all demo chips
✓ menu, quantity cap, persistent cart, slots, counter order, live kitchen/ticket, called overlay, code rejection and collection
✓ student cancellation; kitchen cancellation reason reaches the live ticket
✓ live sold-out stamps/cart reconciliation, batch and made-to-order restock, pause/resume
✓ two real students race for last plate; slot fills and stale checkout is refused; full slot disabled
✓ reports: 7/14/30 days, every table toggle, phone layout, direct MongoDB daily totals
✓ prep plan day changes, risk and leftovers, save/reload, pending-day save blocked
✓ menu editor validation, add/edit/price update, take off menu clears live and persisted cart
✓ team invite registration/return/accept, manager promotion, kitchen demotion, live removal, single-use/decline/cancel
✓ role limits in every manager route; student staff denial; hours validation/save/reload
✓ my orders/history, order privacy, no-show ticket/restriction and online payment unavailable UI
✓ staged online ticket: awaiting payment/cancel and live refund_pending without provider keys
✓ today stock and slot counters reconcile against raw orders after cancellations and races
✓ staff home, create canteen, empty menu/reports/prep plan

All 15 browser workflow groups passed (one Chromium, five isolated contexts).
Closing Chromium PIDs: browser:14, renderer:159, renderer:141, renderer:512, renderer:395, renderer:123, renderer:104, GPU:42, network.mojom.NetworkService:45, storage.mojom.StorageService:60, audio.mojom.AudioService:288
```

### `cd client && npx vite build`

```text
vite v8.3.5 building client environment for production...
transforming...
✓ 95 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.98 kB │ gzip:   0.51 kB
dist/assets/index-sMOQyLeG.css   39.38 kB │ gzip:   9.01 kB
dist/assets/index-Cc3ycThO.js   411.62 kB │ gzip: 127.15 kB

✓ built in 171ms
```

## Process and database cleanup

Each command runs in its own PID namespace, so local PIDs repeat; tool session IDs distinguish them. API sessions 84364, 31350 and 61720 each reported Node PID 2; client sessions 7697 and 27038 each reported Node PID 2. Only these owned service sessions were interrupted, to reload fixes and then at cleanup. The primary browser script logs its Chromium PIDs and closes its own browser in `finally`; the final API test logs API PID 97, MongoDB PID 36 and guardian PID 37 and stops its own children. Early launch probes were also closed immediately. No `pkill` or broad process termination was used.

`agla_e2e` was dropped and verified absent. `agla` was not accessed. Ports 8090 and 5190 were verified closed on IPv4 and IPv6. Existing services were verified listening on 27017, 27018, 8080, 8081, 5173 and 5174 (the two existing Vite ports listen on IPv6 localhost).
