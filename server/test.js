// End-to-end: starts the real server against an in-memory MongoDB and walks every workflow.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { io } from "socket.io-client";
import Order from "./models/order.model.js";
import Stock from "./models/stock.model.js";
import Day from "./models/day.model.js";
import { sweep } from "./utils/sweeper.js";
import { dayOf, addDays, minuteOf, dateAt } from "./utils/time.js";
import { slotBoard, slotStarts } from "./utils/slots.js";

const PORT = 8097;
const BASE = `http://localhost:${PORT}`;
const SECRET = "test-internal-secret";
const RZP_SECRET = "test-razorpay-secret";
const mongo = await MongoMemoryServer.create();

const server = spawn("node", ["index.js"], {
  env: {
    ...process.env, PORT: String(PORT), MONGO_URI: mongo.getUri(), MONGO_DB: "agla-test",
    JWT_SECRET: "test-secret", CLIENT_URL: "http://localhost:5173", INTERNAL_SECRET: SECRET, NODE_ENV: "test",
    RAZORPAY_KEY_ID: "rzp_test_dummy", RAZORPAY_KEY_SECRET: RZP_SECRET,
  },
  stdio: ["ignore", "pipe", "inherit"],
});
console.log(`Test process PIDs: API ${server.pid}, MongoDB ${mongo.instanceInfo.instance.mongodProcess.pid}, MongoDB guardian ${mongo.instanceInfo.instance.killerProcess.pid}`);
await new Promise((resolve) => server.stdout.on("data", (d) => String(d).includes("Server running") && resolve()));
await mongoose.connect(mongo.getUri(), { dbName: "agla-test" });

const call = async (method, path, { body, cookie, headers = {} } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...(cookie && { Cookie: cookie }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: res.headers.get("set-cookie")?.split(";")[0] };
};

const signup = async (name, email) => {
  const res = await call("POST", "/api/auth/register", { body: { name, email, password: "password123" } });
  assert.equal(res.status, 201, `register ${email}: ${res.body?.message}`);
  return res.cookie;
};

const order = (canteenId, cookie, lines, slot, payment = "counter", requestId = randomUUID()) =>
  call("POST", `/api/canteens/${canteenId}/orders`, { cookie, body: { lines, slot, payment, requestId } });

const step = (name) => console.log(`✓ ${name}`);

try {
  // IST crosses midnight at 18:30 UTC; a late-day slot must end by closing
  // time, and neither a full slot nor one past the lead-time boundary opens.
  assert.equal(dayOf(new Date("2026-10-27T18:29:59Z")), "2026-10-27");
  assert.equal(minuteOf(new Date("2026-10-27T18:29:59Z")), 1439);
  assert.equal(dayOf(new Date("2026-10-27T18:30:00Z")), "2026-10-28");
  assert.equal(minuteOf(new Date("2026-10-27T18:30:00Z")), 0);
  assert.equal(dateAt("2026-10-28", 0).toISOString(), "2026-10-27T18:30:00.000Z");
  const closing = { opensAt: 1425, closesAt: 1440, slotMinutes: 5, slotCapacity: 2, leadMinutes: 0 };
  assert.deepEqual(slotStarts(closing), [1425, 1430, 1435]);
  assert.equal(slotBoard(closing, null, new Date("2026-10-27T18:25:00Z")).at(-1).open, true);
  assert.ok(slotBoard(closing, null, new Date("2026-10-27T18:26:00Z")).every((slot) => !slot.open));
  assert.equal(slotBoard(closing, { slots: new Map([["1435", 2]]) }, new Date("2026-10-27T18:25:00Z")).at(-1).open, false);
  assert.ok(slotBoard({ ...closing, leadMinutes: 5 }, null, new Date("2026-10-27T18:25:00Z")).every((slot) => !slot.open));
  step("IST midnight rollover, closing-time slots, lead time and full-slot boundaries");

  // ── Accounts ────────────────────────────────────────────────────────────
  assert.equal((await call("POST", "/api/auth/register", { body: { name: "X", email: "nope", password: "password123" } })).status, 400);
  const owner = await signup("Meena Aunty", "owner@test.dev");
  const cook = await signup("Raju", "cook@test.dev");
  const asha = await signup("Asha", "asha@test.dev");
  const kabir = await signup("Kabir", "kabir@test.dev");
  assert.equal((await call("POST", "/api/auth/register", { body: { name: "Again", email: "asha@test.dev", password: "password123" } })).status, 409);
  assert.equal((await call("POST", "/api/auth/login", { body: { email: "asha@test.dev", password: "wrong-pass" } })).status, 401);
  assert.equal((await call("GET", "/api/canteens/mine")).status, 401);
  step("accounts: register, duplicate email, wrong password, logged-out access");

  // ── Owner sets up a canteen ─────────────────────────────────────────────
  const created = await call("POST", "/api/canteens", { cookie: owner, body: { name: "Block C Canteen", place: "Ground floor, Block C" } });
  assert.equal(created.status, 201);
  const canteen = created.body.canteen;
  assert.equal(canteen.slug, "block-c-canteen");

  // Open all day, every day, tiny slots, so the test runs at any hour.
  const bad = await call("PATCH", `/api/canteens/${canteen._id}`, { cookie: owner, body: { opensAt: 600, closesAt: 500 } });
  assert.equal(bad.status, 400);
  const settings = { opensAt: 0, closesAt: 1440, slotMinutes: 5, slotCapacity: 2, leadMinutes: 0, openDays: [0, 1, 2, 3, 4, 5, 6] };
  assert.equal((await call("PATCH", `/api/canteens/${canteen._id}`, { cookie: owner, body: settings })).status, 200);

  const addItem = async (body) => {
    const res = await call("POST", `/api/canteens/${canteen._id}/items`, { cookie: owner, body });
    assert.equal(res.status, 201, res.body?.message);
    return res.body.item;
  };
  assert.equal((await call("POST", `/api/canteens/${canteen._id}/items`, { cookie: owner, body: { name: "Free", category: "x", price: 0 } })).status, 400);
  const samosa = await addItem({ name: "Samosa", category: "Snacks", price: 2000, cost: 800, dailyLimit: 3 });
  const maggi = await addItem({ name: "Masala Maggi", category: "Noodles", price: 5000, veg: true });
  const chai = await addItem({ name: "Cutting Chai", category: "Drinks", price: 1500 });
  step("owner: create canteen, settings validation, menu items");

  // ── Team: kitchen staff joins with a single-use invite ──────────────────
  const invite = await call("POST", `/api/canteens/${canteen._id}/invites`, { cookie: owner, body: { role: "kitchen", label: "Raju" } });
  assert.equal(invite.status, 201);
  assert.equal((await call("GET", `/api/canteens/${canteen._id}/board`, { cookie: cook })).status, 404, "not staff yet");
  assert.equal((await call("POST", `/api/invites/${invite.body.token}/accept`, { cookie: cook })).status, 200);
  assert.equal((await call("POST", `/api/invites/${invite.body.token}/accept`, { cookie: asha })).status, 404, "single use");
  assert.equal((await call("GET", `/api/canteens/${canteen._id}/board`, { cookie: cook })).status, 200);
  assert.equal((await call("PATCH", `/api/canteens/${canteen._id}`, { cookie: cook, body: { slotCapacity: 50 } })).status, 403, "kitchen can't edit settings");
  assert.equal((await call("GET", `/api/canteens/${canteen._id}/report`, { cookie: cook })).status, 403);
  step("team: invite, accept once, kitchen role limits");

  // ── Student browses the menu ────────────────────────────────────────────
  const menu = await call("GET", "/api/canteens/menu/block-c-canteen", { cookie: asha });
  assert.equal(menu.status, 200);
  assert.equal(menu.body.items.find((i) => i.name === "Samosa").left, 3);
  assert.equal(menu.body.items.find((i) => i.name === "Masala Maggi").left, null, "made to order has no limit");
  assert.equal(menu.body.me.counterAllowed, true);
  const slot = menu.body.slots.find((s) => s.open)?.start;
  assert.ok(slot !== undefined, "an open slot exists (fails only in the last 5 minutes of the IST day)");
  assert.equal((await call("GET", "/api/canteens/menu/block-c-canteen")).body.me, null, "anonymous browse");
  step("student: public menu with stock left and slots");

  // ── Ordering: validation, idempotency, stock, slot capacity ─────────────
  assert.equal((await order(canteen._id, asha, [], slot)).status, 400);
  assert.equal((await order(canteen._id, asha, [{ item: samosa._id, qty: 1 }, { item: samosa._id, qty: 1 }], slot)).status, 400, "duplicate lines");
  assert.equal((await order(canteen._id, asha, [{ item: maggi._id, qty: 1 }], slot + 1)).status, 400, "misaligned slot");
  assert.equal((await order(canteen._id, asha, [{ item: samosa._id, qty: 4 }], slot)).status, 409, "more samosas than made");

  const requestId = randomUUID();
  const first = await order(canteen._id, asha, [{ item: samosa._id, qty: 2 }, { item: chai._id, qty: 1 }], slot, "counter", requestId);
  assert.equal(first.status, 201, first.body?.message);
  assert.equal(first.body.order.total, 2 * 2000 + 1500, "price from the server");
  assert.equal(first.body.order.token, 1);
  assert.match(first.body.order.code, /^\d{4}$/);
  const again = await order(canteen._id, asha, [{ item: samosa._id, qty: 2 }, { item: chai._id, qty: 1 }], slot, "counter", requestId);
  assert.equal(again.status, 200);
  assert.equal(again.body.order._id, first.body.order._id, "same requestId, same order");
  assert.equal((await Stock.findOne({ item: samosa._id })).sold, 2, "the retry didn't take more samosas");

  // One samosa left, two students race for it: exactly one gets it.
  const [a, b] = await Promise.all([
    order(canteen._id, kabir, [{ item: samosa._id, qty: 1 }], slot + 5),
    order(canteen._id, owner, [{ item: samosa._id, qty: 1 }], slot + 5),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409], "last plate goes to one person");
  const stock = await Stock.findOne({ item: samosa._id });
  assert.equal(stock.sold, 3);
  assert.ok(stock.soldOutAt, "sell-out time recorded for the prep plan");
  assert.equal((await call("GET", "/api/canteens/menu/block-c-canteen")).body.items.find((i) => i.name === "Samosa").left, 0);

  // The slot holds 2 orders; Asha's order is in it, Kabir's second fills it, the third is refused.
  assert.equal((await order(canteen._id, kabir, [{ item: maggi._id, qty: 1 }], slot)).status, 201);
  const full = await order(canteen._id, owner, [{ item: maggi._id, qty: 1 }], slot);
  assert.equal(full.status, 409);
  assert.match(full.body.message, /filled up/);

  // Reserving the last plate and then losing a full slot must not leave a
  // phantom sell-out for the prep plan, or consume any stock.
  const rollbackItem = await addItem({ name: "Last plate", category: "Snacks", price: 1000, dailyLimit: 1 });
  const rollback = await order(canteen._id, owner, [{ item: rollbackItem._id, qty: 1 }], slot);
  assert.equal(rollback.status, 409);
  const returned = await Stock.findOne({ item: rollbackItem._id });
  assert.equal(returned.sold, 0);
  assert.equal(returned.soldOutAt, null, "failed checkout mustn't be learned as a sell-out");
  const lastPlate = await order(canteen._id, asha, [{ item: rollbackItem._id, qty: 1 }], slot + 10);
  assert.equal(lastPlate.status, 201);
  assert.ok((await Stock.findOne({ item: rollbackItem._id })).soldOutAt);
  await call("POST", `/api/orders/${lastPlate.body.order._id}/cancel`, { cookie: asha });
  assert.equal((await Stock.findOne({ item: rollbackItem._id })).soldOutAt, null, "returned last plate clears natural sell-out");
  step("ordering: validation, idempotent retry, last-plate race, slot capacity");

  // ── Student cancels: slot and plates come back ──────────────────────────
  const solo = await order(canteen._id, asha, [{ item: maggi._id, qty: 2 }], slot + 10);
  const before = (await Day.findOne({ canteen: canteen._id })).slots.get(String(slot + 10));
  assert.equal((await call("POST", `/api/orders/${solo.body.order._id}/cancel`, { cookie: kabir })).status, 404, "not your order");
  const cancelled = await call("POST", `/api/orders/${solo.body.order._id}/cancel`, { cookie: asha });
  assert.equal(cancelled.body.order.status, "cancelled");
  assert.equal((await Day.findOne({ canteen: canteen._id })).slots.get(String(slot + 10)), before - 1, "slot released");
  assert.equal((await call("POST", `/api/orders/${solo.body.order._id}/cancel`, { cookie: asha })).status, 409, "already cancelled");
  step("cancel: only the owner, releases the slot, only once");

  // ── Kitchen: board, live updates, cook, ready, collect with code ────────
  const { token: socketToken } = (await call("GET", "/api/auth/socket-token", { cookie: asha })).body;
  const socket = io(BASE, { auth: { token: socketToken }, transports: ["websocket"] });
  await new Promise((resolve) => socket.on("connect", resolve));
  const readyEvent = new Promise((resolve) => socket.on("order", (o) => o.status === "ready" && resolve(o)));

  const boardRes = await call("GET", `/api/canteens/${canteen._id}/board`, { cookie: cook });
  const card = boardRes.body.orders.find((o) => o._id === first.body.order._id);
  assert.equal(card.customer, "Asha");
  assert.equal(card.code, undefined, "the kitchen never sees the pickup code");

  const orderId = first.body.order._id;
  assert.equal((await call("POST", `/api/orders/${orderId}/status`, { cookie: kabir, body: { to: "preparing" } })).status, 404, "students can't move orders");
  assert.equal((await call("POST", `/api/orders/${orderId}/status`, { cookie: cook, body: { to: "ready" } })).status, 409, "can't skip cooking");
  const [p1, p2] = await Promise.all([
    call("POST", `/api/orders/${orderId}/status`, { cookie: cook, body: { to: "preparing" } }),
    call("POST", `/api/orders/${orderId}/status`, { cookie: owner, body: { to: "preparing" } }),
  ]);
  assert.deepEqual([p1.status, p2.status].sort(), [200, 409], "two taps, one move");
  assert.equal((await call("POST", `/api/orders/${orderId}/cancel`, { cookie: asha })).status, 409, "too late to cancel once cooking");
  assert.equal((await call("POST", `/api/orders/${orderId}/status`, { cookie: cook, body: { to: "ready" } })).status, 200);
  assert.equal((await readyEvent).token, 1, "student heard it was ready");
  socket.close();

  const wrongCode = String((Number(first.body.order.code) + 1) % 10000).padStart(4, "0");
  assert.equal((await call("POST", `/api/orders/${orderId}/collect`, { cookie: cook, body: { code: wrongCode } })).status, 400);
  const collected = await call("POST", `/api/orders/${orderId}/collect`, { cookie: cook, body: { code: first.body.order.code } });
  assert.equal(collected.body.order.status, "collected");
  assert.equal((await Order.findById(orderId)).payment.status, "paid", "counter order paid at pickup");
  step("kitchen: board without codes, one move per tap, live ready event, code check at pickup");

  const ownOrder = await order(canteen._id, owner, [{ item: maggi._id, qty: 1 }], slot + 10);
  assert.equal(ownOrder.status, 201, ownOrder.body?.message);
  const ownId = ownOrder.body.order._id;
  assert.equal((await call("GET", `/api/orders/${ownId}`, { cookie: owner })).body.order.code, ownOrder.body.order.code, "owner still gets their student view");
  assert.equal((await call("POST", `/api/orders/${ownId}/status`, { cookie: owner, body: { to: "preparing" } })).status, 200);
  assert.equal((await call("POST", `/api/orders/${ownId}/status`, { cookie: owner, body: { to: "ready" } })).status, 200);
  const ownCollected = await call("POST", `/api/orders/${ownId}/collect`, { cookie: owner, body: { code: ownOrder.body.order.code } });
  assert.equal(ownCollected.status, 200);
  assert.equal(ownCollected.body.order.status, "collected", "the owner can collect their own order");
  step("kitchen: owner can cook and collect their own order");

  // ── Kitchen cancels with a reason; sold out and restock ─────────────────
  const kOrder = await order(canteen._id, kabir, [{ item: chai._id, qty: 1 }], slot + 15);
  assert.equal((await call("POST", `/api/orders/${kOrder.body.order._id}/status`, { cookie: cook, body: { to: "cancelled" } })).status, 400, "needs a reason");
  assert.equal((await call("POST", `/api/canteens/${canteen._id}/items/${chai._id}/sold-out`, { cookie: cook })).status, 200);
  const kc = await call("POST", `/api/orders/${kOrder.body.order._id}/status`, { cookie: cook, body: { to: "cancelled", reason: "Milk ran out" } });
  assert.equal(kc.body.order.cancelReason, "Milk ran out");

  assert.equal((await call("GET", "/api/canteens/menu/block-c-canteen")).body.items.find((i) => i._id === chai._id).left, 0, "cancellation doesn't reopen a manually sold-out item");
  const closedChai = (await call("GET", `/api/canteens/${canteen._id}/items`, { cookie: cook })).body.items.find((i) => i._id === chai._id);
  assert.equal(closedChai.today.made, closedChai.today.sold, "the kitchen still sees it as sold out");
  const stillOut = await order(canteen._id, kabir, [{ item: chai._id, qty: 1 }], slot + 15);
  assert.equal(stillOut.status, 409, "sold out after cancellation");
  assert.match(stillOut.body.message, /sold out/);
  assert.equal((await call("POST", `/api/canteens/${canteen._id}/items/${chai._id}/restock`, { cookie: cook })).status, 200);
  assert.equal((await order(canteen._id, kabir, [{ item: chai._id, qty: 1 }], slot + 15)).status, 201, "back on");
  assert.equal((await call("POST", `/api/canteens/${canteen._id}/items/${samosa._id}/restock`, { cookie: cook, body: { add: 5 } })).status, 200);
  assert.equal((await call("GET", "/api/canteens/menu/block-c-canteen")).body.items.find((i) => i.name === "Samosa").left, 5);

  await call("POST", `/api/canteens/${canteen._id}/accepting`, { cookie: cook, body: { acceptingOrders: false } });
  assert.match((await order(canteen._id, asha, [{ item: maggi._id, qty: 1 }], slot + 20)).body.message, /paused/);
  await call("POST", `/api/canteens/${canteen._id}/accepting`, { cookie: cook, body: { acceptingOrders: true } });
  step("kitchen: cancel with reason, manual sold-out survives cancellation, restock, pause orders");

  // ── No-shows take away pay-at-counter ───────────────────────────────────
  const noShowOrders = await Order.find({ user: (await call("GET", "/api/auth/me", { cookie: kabir })).body.user._id, status: "placed" });
  assert.ok(noShowOrders.length >= 2);
  for (const o of noShowOrders.slice(0, 2)) {
    await call("POST", `/api/orders/${o._id}/status`, { cookie: cook, body: { to: "preparing" } });
    await call("POST", `/api/orders/${o._id}/status`, { cookie: cook, body: { to: "ready" } });
  }
  const swept = await sweep(new Date(Date.now() + 2 * 60 * 60 * 1000));
  assert.equal(swept.noShows, 2);
  const kabirMenu = await call("GET", "/api/canteens/menu/block-c-canteen", { cookie: kabir });
  assert.equal(kabirMenu.body.me.counterAllowed, false);
  const refused = await order(canteen._id, kabir, [{ item: maggi._id, qty: 1 }], slot + 25);
  assert.equal(refused.status, 403);
  assert.match(refused.body.message, /paid online/);
  step("sweeper: uncollected food becomes a no-show; two no-shows → pay online only");

  // ── Online payment: start fails cleanly, signature checks, late payments refunded ─
  const failed = await order(canteen._id, asha, [{ item: maggi._id, qty: 1 }], slot + 25, "online");
  assert.equal(failed.status, 502, "dummy Razorpay keys: the payment can't start");
  const failedOrder = await Order.findOne({ user: (await Order.findById(orderId)).user, status: "cancelled", "payment.method": "online" });
  assert.equal(failedOrder.cancelledBy, "system", "and the reservation was given back");

  const aliceId = (await Order.findById(orderId)).user;
  const today = dayOf();
  const paidOrder = await Order.create({
    canteen: canteen._id, user: aliceId, customer: "Asha", day: today, token: 99, slot: slot + 30, pickupAt: new Date(Date.now() + 3600e3),
    lines: [{ item: maggi._id, name: "Masala Maggi", price: 5000, qty: 1 }], total: 5000, status: "awaiting_payment",
    code: "1234", requestId: randomUUID(), payment: { method: "online", razorpayOrderId: "order_test_1" },
  });
  const sign = (rzpOrder, paymentId) => createHmac("sha256", RZP_SECRET).update(`${rzpOrder}|${paymentId}`).digest("hex");
  assert.equal((await call("POST", `/api/orders/${paidOrder._id}/pay`, { cookie: asha, body: { paymentId: "pay_1", signature: "forged" } })).status, 400);
  const paid = await call("POST", `/api/orders/${paidOrder._id}/pay`, { cookie: asha, body: { paymentId: "pay_1", signature: sign("order_test_1", "pay_1") } });
  assert.equal(paid.body.order.status, "placed");
  assert.equal(paid.body.order.payment.status, "paid");
  const refundSocket = io(BASE, { auth: { token: socketToken }, transports: ["websocket"] });
  try {
    await new Promise((resolve) => refundSocket.on("connect", resolve));
    const pendingEvent = new Promise((resolve) => refundSocket.on("order", (o) => {
      if (o._id === String(paidOrder._id) && o.payment.status === "refund_pending") resolve(o);
    }));
    const refund = await call("POST", `/api/orders/${paidOrder._id}/status`, { cookie: cook, body: { to: "cancelled", reason: "Kitchen closed" } });
    assert.equal(refund.body.order.payment.status, "refund_pending", "refund call failed with dummy keys, so it waits for a retry");
    const notified = await Promise.race([pendingEvent, new Promise((resolve) => setTimeout(() => resolve(null), 1000))]);
    assert.ok(notified, "student hears refund_pending even when the refund provider fails");
  } finally {
    refundSocket.close();
  }

  const lateOrder = await Order.create({
    canteen: canteen._id, user: aliceId, customer: "Asha", day: today, token: 100, slot: slot + 30, pickupAt: new Date(Date.now() + 3600e3),
    lines: [{ item: maggi._id, name: "Masala Maggi", price: 5000, qty: 1 }], total: 5000, status: "cancelled", cancelledBy: "system",
    code: "1234", requestId: randomUUID(), payment: { method: "online", razorpayOrderId: "order_test_2" },
  });
  const late = await call("POST", `/api/orders/${lateOrder._id}/pay`, { cookie: asha, body: { paymentId: "pay_2", signature: sign("order_test_2", "pay_2") } });
  assert.equal(late.status, 409);
  assert.equal(late.body.order.payment.status, "refund_pending", "paid after expiry → refunded");
  step("payments: start failure releases, forged signature refused, cancel refunds, late payment refunded");

  // ── Sweeper: unpaid checkouts expire ────────────────────────────────────
  const stale = await Order.create({
    canteen: canteen._id, user: aliceId, customer: "Asha", day: today, token: 101, slot: slot + 30, pickupAt: new Date(Date.now() + 3600e3),
    lines: [{ item: maggi._id, name: "Masala Maggi", price: 5000, qty: 1 }], total: 5000, status: "awaiting_payment",
    code: "1234", requestId: randomUUID(), payment: { method: "online", razorpayOrderId: "order_test_3" },
  });
  await sweep(new Date(Date.now() + 20 * 60 * 1000));
  assert.equal((await Order.findById(stale._id)).status, "cancelled");
  assert.equal((await call("POST", "/internal/sweep")).status, 401);
  assert.equal((await call("POST", "/internal/sweep", { headers: { Authorization: `Bearer ${SECRET}` } })).status, 200);
  step("sweeper: unpaid checkout expires; internal endpoint needs the secret");

  // ── Prep plan and report ────────────────────────────────────────────────
  // Four past weeks of the same weekday: 30, 32, 28, 31 samosas sold, the last week sold out.
  const target = addDays(today, 1);
  for (const [i, sold] of [30, 32, 28, 31].entries()) {
    const past = addDays(target, -7 * (i + 1));
    await Day.create({ canteen: canteen._id, day: past, tokenSeq: sold });
    await Stock.create({ canteen: canteen._id, item: samosa._id, day: past, made: i === 0 ? 30 : 40, sold: i === 0 ? 30 : sold, soldOutAt: i === 0 ? new Date() : null });
  }
  const plan = await call("GET", `/api/canteens/${canteen._id}/plan`, { cookie: owner });
  assert.equal(plan.status, 200);
  const samosaPlan = plan.body.plan.find((row) => row.item.name === "Samosa");
  const newDishPlan = plan.body.plan.find((row) => row.item._id === rollbackItem._id);
  assert.equal(newDishPlan.history.length, 0, "a new dish doesn't inherit zero sales from before it existed");
  assert.equal(newDishPlan.suggestion, null, "a new dish needs its own history before suggesting a quantity");
  assert.ok(samosaPlan.suggestion >= 28 && samosaPlan.suggestion <= 40, `samosa suggestion ${samosaPlan.suggestion}`);
  assert.equal((await call("GET", `/api/canteens/${canteen._id}/plan?day=2001-01-01`, { cookie: owner })).status, 400);
  assert.equal((await call("PUT", `/api/canteens/${canteen._id}/plan`, { cookie: owner, body: { day: target, quantities: [{ item: maggi._id, made: 10 }] } })).status, 400, "made-to-order can't be planned");
  assert.equal((await call("PUT", `/api/canteens/${canteen._id}/plan`, { cookie: owner, body: { day: today, quantities: [{ item: samosa._id, made: 1 }] } })).status, 409, "below what's already ordered");
  assert.equal((await call("PUT", `/api/canteens/${canteen._id}/plan`, { cookie: owner, body: { day: target, quantities: [{ item: samosa._id, made: samosaPlan.suggestion }] } })).status, 200);
  assert.equal((await Stock.findOne({ item: samosa._id, day: target })).made, samosaPlan.suggestion);

  const report = await call("GET", `/api/canteens/${canteen._id}/report?days=7`, { cookie: owner });
  assert.equal(report.status, 200);
  assert.equal(report.body.days.length, 7);
  assert.ok(report.body.totals.orders >= 5);
  assert.ok(report.body.totals.noShows >= 2);
  assert.ok(report.body.topItems.length > 0);
  step("prep plan from history, plan validation, report");

  // ── My orders ───────────────────────────────────────────────────────────
  const pending = await Order.create({
    canteen: canteen._id, user: aliceId, customer: "Asha", day: today, token: 102, slot: slot + 30, pickupAt: new Date(Date.now() + 3600e3),
    lines: [{ item: maggi._id, name: "Masala Maggi", price: 5000, qty: 1 }], total: 5000, status: "awaiting_payment",
    code: "1234", requestId: randomUUID(), payment: { method: "online" },
  });
  const mine = await call("GET", "/api/orders", { cookie: asha });
  assert.equal(mine.status, 200);
  assert.ok(mine.body.orders.some((o) => o._id === String(pending._id) && o.status === "awaiting_payment"), "awaiting payment appears in my orders");
  assert.ok(mine.body.orders.some((o) => o.canteen.name === "Block C Canteen"));
  assert.equal((await call("GET", `/api/orders/${orderId}`, { cookie: kabir })).status, 404, "someone else's order");
  step("my orders: history, awaiting payment, privacy");

  console.log("\nAll Agla workflows passed");
} finally {
  server.kill();
  await mongoose.disconnect();
  await mongo.stop();
}
