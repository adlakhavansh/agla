// Real UI tests. Seed agla_e2e and start the isolated API/client first; see README.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '/home/predator/.npm/_npx/31e32ef8478fbf80/node_modules/playwright-core/index.mjs';
import { dayOf, addDays, minuteOf } from '../server/utils/time.js';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const mongoose = require('mongoose');
const BASE = (process.env.BASE || 'http://localhost:5190').replace(/\/$/, '');
const API = (process.env.API || 'http://localhost:8090').replace(/\/$/, '');
const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27018';
assert.equal(process.env.MONGO_DB || 'agla_e2e', 'agla_e2e', 'Browser fixtures may only use agla_e2e');
const db = await mongoose.createConnection(mongoUri, { dbName: 'agla_e2e' }).asPromise();
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', chromiumSandbox: false, args: ['--disable-dev-shm-usage'] });
const browserSession = await browser.newBrowserCDPSession();
const { processInfo } = await browserSession.send('SystemInfo.getProcessInfo');
console.log('Chromium PIDs started:', processInfo.map(p => `${p.type}:${p.id}`).join(', '));
await mkdir('output/playwright', { recursive: true });
const errors = [], expected = new Set(), pages = [];
let steps = 0;
const step = text => { steps++; console.log(`✓ ${text}`); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message, timeout = 10000) {
  const end = Date.now() + timeout;
  let last;
  do { try { const value = await fn(); if (value) return value; } catch (error) { last = error; } await sleep(80); } while (Date.now() < end);
  throw new Error(`${message}${last ? `: ${last.message}` : ''}`);
}
async function visible(locator) { await locator.waitFor({ state: 'visible' }); }
async function text(page, value) { await visible(page.getByText(value, { exact: true }).first()); }
async function heading(page, value) { await visible(page.getByRole('heading', { name: value, exact: true })); }
async function goto(page, path) { await page.goto(BASE + path); }
async function actor(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', timezoneId: 'Asia/Kolkata' });
  const page = await context.newPage(); pages.push(page);
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(`${name}: ${error.stack}`));
  page.on('response', res => {
    if (res.status() < 400) return;
    const url = new URL(res.url()), key = `${name}:${res.status()}:${url.pathname}`;
    if (res.status() === 401 && ['/api/auth/me', '/api/auth/socket-token'].includes(url.pathname)) return;
    if (expected.has(key)) return;
    errors.push(`${name}: unexpected HTTP ${res.status()} ${url.pathname}`);
  });
  page.on('console', message => {
    // Chromium's network errors are checked against exact expected HTTP responses above.
    if (message.type() === 'error' && !/^Failed to load resource: the server responded with a status of \d+/.test(message.text())) errors.push(`${name}: ${message.text()} ${JSON.stringify(message.location())}`);
  });
  page.on('requestfailed', request => errors.push(`${name}: request failed ${request.url()}: ${request.failure()?.errorText}`));
  page.orderEvents = [];
  page.on('websocket', ws => ws.on('framereceived', ({payload}) => {
    if (typeof payload !== 'string' || !payload.startsWith('42')) return;
    try { const [event,order] = JSON.parse(payload.slice(2)); if(event==='order') page.orderEvents.push(order); } catch {}
  }));
  page.actorName = name;
  return page;
}
function expectHttp(page, status, path) {
  const key = `${page.actorName}:${status}:${path}`;
  expected.add(key);
}
async function api(page, method, path, body, status = 200) {
  const res = await page.context().request.fetch(API + path, { method, data: body });
  const data = await res.json(); assert.equal(res.status(), status, `${method} ${path}: ${JSON.stringify(data)}`); return data;
}
async function submit(page, name, path, status = 200) {
  if (status >= 400) expectHttp(page, status, path);
  const [r] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() !== 'GET'),
    page.getByRole('button', { name, exact: true }).last().click(),
  ]); assert.equal(r.status(), status, await r.text()); return r.json();
}
async function demo(page, role) {
  if (new URL(page.url()).pathname !== '/login') await goto(page, '/login'); await heading(page, 'Log in');
  await page.getByRole('button', { name: role, exact: true }).click();
  assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), `${role.toLowerCase()}@demo.agla.app`);
  assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), 'agla-demo');
  await submit(page, 'Log in', '/api/auth/login'); await page.waitForURL(url => url.pathname !== '/login');
}
async function register(page, email, name) {
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await submit(page, 'Make account', '/api/auth/register', 201);
}
async function noScroll(page, label) {
  const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(metrics.scroll <= metrics.width, `${label}: horizontal scroll ${JSON.stringify(metrics)}`);
}
const menuRow = (p, name) => p.locator('.menu-row').filter({ has: p.locator('.menu-name', { hasText: new RegExp(`^${name}$`) }) });
const stockRow = (p, name) => p.locator('.stock-panel li').filter({ has: p.locator('.stock-name', { hasText: new RegExp(`^${name}$`) }) });
const slip = (p, token) => p.locator('.slip').filter({ has: p.locator('.slip-token', { hasText: new RegExp(`^${token}$`) }) });
async function add(page, name, count = 1) {
  const row = menuRow(page, name); await row.getByRole('button', { name: `Add ${name}`, exact: true }).click();
  for (let i = 1; i < count; i++) await row.getByRole('button', { name: `One more ${name}`, exact: true }).click();
}
async function selectSlot(page, slot) { await page.locator(`label.slot`).filter({ has: page.locator(`input[name="slot"][value="${slot}"]`) }).click(); }
async function order(page, slot, canteenId) {
  await selectSlot(page, slot);
  const path = `/api/canteens/${canteenId}/orders`;
  const response = page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === 'POST');
  await page.locator('.cart').getByRole('button', { name: /^Order for / }).click();
  const res = await response; assert.equal(res.status(), 201, await res.text());
  const data = await res.json(); await page.waitForURL(`**/orders/${data.order._id}`); await heading(page, 'Your order is in');
  return data.order;
}
async function cancel(page) {
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click(); await heading(page, 'This order was cancelled');
}
async function phone(page, path, ready, label) {
  await page.setViewportSize({ width: 390, height: 844 }); await goto(page, path); await ready();
  if(label==='menu' && await page.locator('.cart-bar').count()) { await page.locator('.cart-bar').click(); await visible(page.locator('.cart-dock.open')); }
  await noScroll(page, label);
  await page.screenshot({ path: `output/playwright/${label}.png`, fullPage: false });
  await page.setViewportSize({ width: 1280, height: 900 });
}
try {
  assert.equal((await fetch(API + '/health')).status, 200);
  const canteens = await (await fetch(API + '/api/canteens')).json();
  const canteen = canteens.canteens.find(c => c.slug === 'block-c-canteen'); assert.ok(canteen, 'Seed agla_e2e first');
  assert.ok(await db.collection('canteens').findOne({_id:new mongoose.Types.ObjectId(canteen._id)}), 'API must be using the same agla_e2e database');
  const cid = canteen._id, staff = `/staff/${cid}`, menu = `/c/${canteen.slug}`, today = dayOf();
  // Fixtures only: normal hours could be closed when the suite runs. All user actions below use the UI.
  await db.collection('canteens').updateOne({ _id: new mongoose.Types.ObjectId(cid) }, { $set: { opensAt: 0, closesAt: 1440, slotMinutes: 5, slotCapacity: 3, leadMinutes: 0, openDays: [0,1,2,3,4,5,6], acceptingOrders: true } });
  const student = await actor('student'), second = await actor('second'), kitchen = await actor('kitchen'), owner = await actor('owner');
  await goto(student, '/'); await heading(student, 'Order before class ends. Eat when it does.');
  await visible(student.locator('.story')); await visible(student.locator('.proof'));
  await until(() => student.locator('.shop-sign canvas').evaluate(c => c.width > 0 && c.height > 0 && c.getContext('2d').getImageData(0,0,c.width,c.height).data.some(v => v > 0)), 'LED canvas painted');
  await phone(student, '/', () => heading(student, 'Order before class ends. Eat when it does.'), 'landing');
  await goto(student, '/canteens'); await visible(student.getByRole('link', { name: /Block C Canteen/ }));
  await goto(student, '/nothing-here'); await heading(student, 'Nothing at this counter');
  step('landing LED, hero, story, proof; canteen list; 404; phone landing');

  await goto(second, '/orders'); await second.waitForURL('**/login');
  await second.getByRole('link', { name: 'Make an account', exact: true }).click();
  await submit(second, 'Make account', '/api/auth/register', 400); await text(second, 'Name, email and password are required');
  await second.getByLabel('Name', { exact: true }).fill('Browser Student');
  await second.getByLabel('Email', { exact: true }).fill('invalid'); await second.getByLabel('Password', { exact: true }).fill('password123');
  await submit(second, 'Make account', '/api/auth/register', 400); await text(second, 'Enter a valid email address');
  const email = `browser-${Date.now()}@test.agla.app`;
  await second.getByLabel('Email', { exact: true }).fill(email); await second.getByLabel('Password', { exact: true }).fill('short');
  await submit(second, 'Make account', '/api/auth/register', 400); await text(second, 'Password must be at least 8 characters');
  await register(second, email, 'Browser Student'); await second.waitForURL('**/orders');
  await second.locator('.avatar').click(); await second.getByRole('menuitem', { name: 'Log out' }).click(); await second.waitForURL(BASE + '/');
  await goto(second, '/register'); await registerDuplicate();
  async function registerDuplicate() {
    await second.getByLabel('Name', { exact: true }).fill('Duplicate'); await second.getByLabel('Email', { exact: true }).fill(email); await second.getByLabel('Password', { exact: true }).fill('password123');
    await submit(second, 'Make account', '/api/auth/register', 409); await text(second, 'An account with this email already exists');
  }
  await goto(second, '/orders'); await second.waitForURL('**/login');
  await second.getByLabel('Email', { exact: true }).fill(email); await second.getByLabel('Password', { exact: true }).fill('wrong-password');
  await submit(second, 'Log in', '/api/auth/login', 401); await text(second, 'Wrong email or password');
  await second.getByLabel('Password', { exact: true }).fill('password123'); await submit(second, 'Log in', '/api/auth/login'); await second.waitForURL('**/orders');
  await goto(student, menu); await add(student, 'Samosa');
  await student.locator('.cart').getByRole('button', {name:'Log in to order',exact:true}).click(); await student.waitForURL('**/login');
  await demo(student, 'Student'); await student.waitForURL(`**${menu}`);
  assert.equal(await menuRow(student,'Samosa').locator('output').innerText(),'1','cart survives login detour');
  await menuRow(student,'Samosa').getByRole('button',{name:'One less Samosa',exact:true}).click();
  await demo(kitchen, 'Kitchen'); await demo(owner, 'Owner');
  step('registration validation/duplicate, login errors, logout, return to protected route, all demo chips');

  await goto(kitchen, staff + '/kitchen'); await heading(kitchen, canteen.name);
  await until(()=>kitchen.evaluate(async()=>(await import('/src/services/socket.js')).socket.connected),'kitchen socket connected');
  const sessionSocket=await kitchen.evaluate(async()=>{
    const {socket}=await import('/src/services/socket.js'); const id=socket.id;
    const moduleUrl=(path)=>performance.getEntriesByType('resource').filter(r=>new URL(r.name).pathname===path).at(-1)?.name || path;
    const {store}=await import(moduleUrl('/src/store/index.js')); const {fetchMe}=await import(moduleUrl('/src/store/authSlice.js'));
    await Promise.all([store.dispatch(fetchMe()),store.dispatch(fetchMe())]);
    return {before:id,after:socket.id,connected:socket.connected};
  });
  assert.equal(sessionSocket.after,sessionSocket.before,'rechecking the same session must not tear down its live socket');
  assert.ok(sessionSocket.connected);
  await goto(student, menu); await heading(student, canteen.name);
  assert.ok(await student.locator('.cats a').count() >= 4);
  await visible(student.getByRole('img', { name: 'Vegetarian', exact: true }).first());
  await visible(student.getByRole('img', { name: 'Non-vegetarian', exact: true }).first());
  await visible(student.getByRole('marquee', { name: /Running low/ }));
  await add(student, 'Samosa', 2); await student.reload(); await heading(student, canteen.name);
  assert.equal(await menuRow(student, 'Samosa').locator('output').innerText(), '2', 'cart survives reload');
  await phone(student, menu, () => heading(student, canteen.name), 'menu');
  await add(student, 'Masala Maggi', 10); assert.ok(await menuRow(student, 'Masala Maggi').getByRole('button', { name: 'One more Masala Maggi' }).isDisabled());
  for (let i=0;i<10;i++) await menuRow(student, 'Masala Maggi').getByRole('button', { name: 'One less Masala Maggi' }).click();
  const menuData = await api(student, 'GET', `/api/canteens/menu/${canteen.slug}`);
  const openSlots = menuData.slots.filter(s => s.open); assert.ok(openSlots.length >= 8, 'Run at least 40 minutes before IST midnight');
  const slot = openSlots[1].start;
  for (const past of menuData.slots.filter(s => s.start < minuteOf())) assert.equal(await student.locator(`input[name="slot"][value="${past.start}"]:enabled`).count(), 0, 'past slots unavailable');
  assert.equal(await student.getByRole('radio', { name: /Pay now/ }).count(), 0, 'online checkout hidden without keys');
  const first = await order(student, slot, cid);
  await visible(student.locator('.token-housing')); assert.equal((await student.locator('.code').innerText()).replace(/\s/g,''), first.code);
  assert.equal(await student.locator('.progress li').count(), 4);
  await visible(slip(kitchen, first.token)); await text(kitchen, 'Collect ₹30');
  await phone(student, `/orders/${first._id}`, () => heading(student, 'Your order is in'), 'ticket');
  await slip(kitchen, first.token).getByRole('button', { name: 'Start cooking' }).click(); await heading(student, "It's on the stove");
  assert.equal(await student.getByRole('button', { name: 'Cancel order', exact: true }).count(), 0);
  await slip(kitchen, first.token).getByRole('button', { name: 'Ready', exact: true }).click();
  const overlay = student.getByRole('alertdialog'); await visible(overlay); await heading(student, `Token ${first.token}, your food is ready`);
  assert.ok(await overlay.evaluate(el => el.getBoundingClientRect().height >= innerHeight - 1));
  await student.setViewportSize({width:390,height:844}); await noScroll(student,'ready overlay');
  await student.screenshot({path:'output/playwright/ready.png'}); await student.setViewportSize({width:1280,height:900});
  await overlay.getByRole('button', { name: 'On my way' }).click();
  await slip(kitchen, first.token).getByRole('button', { name: 'Hand over' }).click();
  await text(kitchen, 'Collect ₹30 first'); const pad = kitchen.getByRole('dialog');
  const wrong = String((Number(first.code) + 1) % 10000).padStart(4,'0');
  expectHttp(kitchen, 400, `/api/orders/${first._id}/collect`);
  for (const digit of wrong) await pad.getByRole('button', { name: digit, exact: true }).click();
  await text(kitchen, "That code doesn't match. Ask the student to check their token.");
  for (const digit of first.code) await pad.getByRole('button', { name: digit, exact: true }).click();
  await heading(student, 'Enjoy your food'); await text(student, 'Paid at the counter');
  assert.ok(student.orderEvents.some(o=>o._id===first._id && o.code===first.code),'student socket receives own pickup code');
  assert.ok(kitchen.orderEvents.some(o=>o._id===first._id),'kitchen socket receives order');
  assert.ok(kitchen.orderEvents.filter(o=>o._id===first._id).every(o=>o.code===undefined),'kitchen socket never receives pickup code');
  assert.ok(second.orderEvents.every(o=>o._id!==first._id),'other student socket never receives this order');
  step('menu, quantity cap, persistent cart, slots, counter order, live kitchen/ticket, called overlay, code rejection and collection');

  await goto(student, menu); await add(student, 'Samosa'); const cancelled = await order(student, slot, cid); await cancel(student);
  await until(() => slip(kitchen, cancelled.token).count().then(n => n === 0), 'cancel removed slip');
  await goto(student, menu); await add(student, 'Cutting Chai'); const kitchenCancelled = await order(student, slot, cid);
  await slip(kitchen, kitchenCancelled.token).getByRole('button', { name: `Cancel token ${kitchenCancelled.token}` }).click();
  await kitchen.getByLabel('Reason', { exact: true }).fill('Browser test: milk ran out');
  await kitchen.getByRole('dialog').getByRole('button', { name: 'Cancel order', exact: true }).click();
  await heading(student, 'This order was cancelled'); await text(student, 'Browser test: milk ran out');
  step('student cancellation; kitchen cancellation reason reaches the live ticket');

  await goto(student, menu); await add(student, 'Samosa', 2);
  // A menu must catch up after a missed socket event (e.g. a phone waking up).
  await until(()=>student.evaluate(async()=>(await import('/src/services/socket.js')).socket.connected),'menu socket connected before disconnect');
  await student.evaluate(async()=>{(await import('/src/services/socket.js')).socket.disconnect();});
  await kitchen.getByRole('button', { name: 'Stock', exact: true }).click();
  await submitStockSoldOut();
  async function submitStockSoldOut() {
    const response=kitchen.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/sold-out'));
    await stockRow(kitchen,'Samosa').getByRole('button',{name:'Mark sold out'}).click(); assert.equal((await response).status(),200);
  }
  await student.evaluate(async()=>{(await import('/src/services/socket.js')).socket.connect();});
  await visible(menuRow(student, 'Samosa').getByText('Sold out for today', { exact: true }));
  // Regression: a live sell-out must remove unavailable cart lines, including persisted counts.
  await until(() => student.locator('.cart-lines').count().then(n => n === 0), 'sold-out item removed from cart');
  assert.equal(await menuRow(student, 'Samosa').getByRole('button', { name: 'Add Samosa' }).count(), 0);
  await stockRow(kitchen, 'Samosa').getByLabel('Extra Samosa').fill('4');
  await stockRow(kitchen, 'Samosa').getByRole('button', { name: 'Add plates' }).click();
  await visible(menuRow(student, 'Samosa').getByText('4 left', { exact: true }));
  await stockRow(kitchen, 'Cutting Chai').getByRole('button', { name: 'Mark sold out' }).click();
  await visible(menuRow(student, 'Cutting Chai').getByText('Sold out for today', { exact: true }));
  await stockRow(kitchen, 'Cutting Chai').getByRole('button', { name: 'Back on' }).click();
  await visible(menuRow(student, 'Cutting Chai').getByRole('button', { name: 'Add Cutting Chai' }));
  // Keep the stock panel open while the student reserves and returns a plate.
  const panelBefore=Number((await stockRow(kitchen,'Samosa').locator('.stock-left').innerText()).split(' ')[0]);
  await add(student,'Samosa'); const panelOrder=await order(student,slot,cid);
  await until(async()=>Number((await stockRow(kitchen,'Samosa').locator('.stock-left').innerText()).split(' ')[0])===panelBefore-1,'open stock panel updates after an order');
  await cancel(student);
  await until(async()=>Number((await stockRow(kitchen,'Samosa').locator('.stock-left').innerText()).split(' ')[0])===panelBefore,'open stock panel updates after cancellation');
  await goto(student,menu);
  await kitchen.getByRole('button', { name: 'Done', exact: true }).click();
  await add(student, 'Samosa');
  await kitchen.getByRole('button', { name: 'Pause new orders' }).click();
  await text(student, 'The kitchen has paused new orders for a few minutes.');
  assert.ok(await student.locator('.cart').getByRole('button', { name: 'Pick a pickup time' }).isDisabled());
  await kitchen.getByRole('button', { name: 'Orders paused. Resume' }).click(); await visible(student.locator('.slots'));
  const resumed = await order(student, slot, cid); await cancel(student);
  step('live sold-out stamps/cart reconciliation, batch and made-to-order restock, pause/resume');

  // One plate, two UI checkouts, released together at the API boundary. No mocked responses.
  const samosa = menuData.items.find(i => i.name === 'Samosa');
  const raceStock=await db.collection('stocks').findOne({ item: new mongoose.Types.ObjectId(samosa._id), day: today });
  await db.collection('stocks').updateOne({ _id: raceStock._id }, { $set: { made: raceStock.sold + 1, closed: false, soldOutAt: null } });
  await goto(student, menu); await goto(second, menu); await add(student, 'Samosa'); await add(second, 'Samosa');
  await selectSlot(student, slot); await selectSlot(second, slot);
  const path = `/api/canteens/${cid}/orders`, held = [];
  let release; const gate = new Promise(resolve => release = resolve);
  for (const page of [student, second]) {
    expectHttp(page, 409, path);
    await page.route(`**${path}`, async route => { held.push(route); if (held.length === 2) release(); await gate; await route.continue(); });
  }
  const results = [student,second].map(p => p.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === 'POST'));
  await Promise.all([student,second].map(p => p.locator('.cart').getByRole('button', { name: /^Order for / }).click()));
  const responses = await Promise.all(results); assert.deepEqual(responses.map(r => r.status()).sort(), [201,409]);
  const winner = [student,second][responses.findIndex(r=>r.status()===201)], loser = winner === student ? second : student;
  const won = (await responses.find(r=>r.status()===201).json()).order;
  await visible(loser.getByRole('alert').filter({ hasText: /Samosa just sold out|Only .* Samosa left/ }));
  for(const page of [student,second]) await page.unroute(`**${path}`);
  await winner.waitForURL(`**/orders/${won._id}`); await cancel(winner);
  // Check slot capacity by holding two stale UI checkouts for the final remaining place.
  await db.collection('canteens').updateOne({ _id: new mongoose.Types.ObjectId(cid) }, { $set: { slotCapacity: 1 } });
  const fullSlot = openSlots[3].start;
  await goto(student, menu); await goto(second, menu); await add(student, 'Masala Maggi'); await add(second, 'Masala Maggi');
  await selectSlot(student, fullSlot); await selectSlot(second, fullSlot);
  let pendingRoute, releaseSecond; const staleGate = new Promise(resolve => releaseSecond=resolve);
  await second.route(`**${path}`, async route => { pendingRoute=route; await staleGate; await route.continue(); });
  expectHttp(second, 409, path);
  const refused = second.waitForResponse(r=>new URL(r.url()).pathname===path && r.request().method()==='POST');
  await second.locator('.cart').getByRole('button', { name: /^Order for / }).click();
  await until(()=>Boolean(pendingRoute), 'second checkout held');
  const filling = await order(student, fullSlot, cid); releaseSecond();
  assert.equal((await refused).status(),409); await visible(second.getByRole('alert').filter({hasText:/just filled up/})); await second.unroute(`**${path}`);
  await goto(owner, menu); await add(owner, 'Masala Maggi');
  // A full slot after the first open slot stays visible but disabled.
  assert.ok(await owner.locator(`input[name="slot"][value="${fullSlot}"]`).isDisabled());
  await cancel(student);
  await db.collection('canteens').updateOne({ _id: new mongoose.Types.ObjectId(cid) }, { $set: { slotCapacity: 3 } });
  step('two real students race for last plate; slot fills and stale checkout is refused; full slot disabled');

  await phone(kitchen, staff + '/kitchen', () => heading(kitchen,canteen.name), 'kitchen');
  await goto(owner, staff + '/report'); await heading(owner,'Reports');
  for(const days of [7,14,30]) {
    const response=owner.waitForResponse(r=>new URL(r.url()).pathname===`/api/canteens/${cid}/report` && new URL(r.url()).search===`?days=${days}`);
    await owner.getByRole('button',{name:`Last ${days} days`,exact:true}).click(); const report=await (await response).json();
    assert.equal(report.days.length,days);
    for(let i=0;i<3;i++) {await owner.getByRole('button',{name:'Show table',exact:true}).first().click();}
    assert.equal(await owner.locator('.data-table').count(),3);
    assert.equal(await owner.locator('.data-table').first().locator('tbody tr').count(),days);
    for(let i=0;i<3;i++) await owner.getByRole('button',{name:'Show chart',exact:true}).first().click();
    const yesterday = addDays(today,-1);
    const raw = await db.collection('orders').find({canteen:new mongoose.Types.ObjectId(cid),day:yesterday,'times.placedAt':{$ne:null}}).toArray();
    const row=report.days.find(d=>d.day===yesterday); assert.equal(row.orders,raw.length);
    assert.equal(row.revenue,raw.filter(o=>o.payment.status==='paid').reduce((sum,o)=>sum+o.total,0));
    assert.equal(row.noShows,raw.filter(o=>o.status==='no_show').length);
    assert.equal(row.cancelled,raw.filter(o=>o.status==='cancelled').length);
    assert.equal(row.cooked,raw.filter(o=>o.times.readyAt).length);
    assert.equal(row.onTime,raw.filter(o=>o.times.readyAt && o.times.readyAt<=o.pickupAt).length);
    const rawStocks=await db.collection('stocks').find({canteen:new mongoose.Types.ObjectId(cid),day:yesterday,made:{$ne:null}}).toArray();
    const rawItems=await db.collection('items').find({canteen:new mongoose.Types.ObjectId(cid)}).toArray();
    const costs=new Map(rawItems.map(i=>[String(i._id),i.cost ?? Math.round(i.price*0.4)]));
    assert.equal(row.leftoverPlates,rawStocks.reduce((sum,s)=>sum+Math.max(0,s.made-s.sold),0));
    assert.equal(row.leftoverCost,rawStocks.reduce((sum,s)=>sum+Math.max(0,s.made-s.sold)*(costs.get(String(s.item))||0),0));
    assert.equal(report.totals.orders,report.days.reduce((sum,d)=>sum+d.orders,0));
    assert.equal(report.totals.revenue,report.days.reduce((sum,d)=>sum+d.revenue,0));
  }
  await phone(owner,staff+'/report',()=>visible(owner.locator('.report')),'reports');
  step('reports: 7/14/30 days, every table toggle, phone layout, direct MongoDB daily totals');

  await goto(owner,staff+'/plan'); await heading(owner,'Prep plan');
  const planInput=owner.getByLabel('Make how many Samosa',{exact:true}); await visible(planInput);
  await planInput.fill('0'); const planRow=owner.locator('.plan-table tbody tr').filter({has:planInput}); const zero=await planRow.innerText();
  await planInput.fill('200'); await until(async()=>await planRow.innerText()!==zero,'risk/leftover responds to quantity');
  assert.match(await planRow.innerText(),/Hasn't run out/);
  await planInput.fill('73'); await submit(owner,await owner.getByRole('button',{name:/^Save plan for /}).innerText(),`/api/canteens/${cid}/plan`);
  await text(owner,'Plan saved');
  const tabs=owner.getByRole('tab'); await tabs.nth(1).click();
  await until(()=>planInput.inputValue().then(v=>v!=='73'),'switch day loads its quantities');
  await tabs.nth(0).click(); await until(()=>planInput.inputValue().then(v=>v==='73'),'saved day reloads');
  await owner.reload(); await until(()=>owner.getByLabel('Make how many Samosa',{exact:true}).inputValue().then(v=>v==='73'),'saved plan survives reload');
  // Stale day response cannot save the previous day's quantities under a new date.
  let releasePlan; const planGate=new Promise(resolve=>releasePlan=resolve);
  await owner.route(`**/api/canteens/${cid}/plan?*`,async route=>{await planGate;await route.continue();});
  await owner.getByRole('tab').nth(1).click(); assert.ok(await owner.getByRole('button',{name:/^Save plan for /}).isDisabled());
  releasePlan(); await owner.unrouteAll({ behavior: 'wait' });
  await until(()=>owner.getByRole('button',{name:/^Save plan for /}).isEnabled(),'new day ready');
  step('prep plan day changes, risk and leftovers, save/reload, pending-day save blocked');

  await goto(owner,staff+'/menu'); await heading(owner,'Menu'); await owner.getByRole('button',{name:'Add item',exact:true}).click();
  const form=owner.getByRole('dialog'); await form.getByLabel('Name',{exact:true}).fill('Browser Batch'); await form.getByLabel('Section',{exact:true}).fill('Browser');
  await form.getByLabel('Price (₹)',{exact:true}).fill('25'); await form.getByLabel('Cost to make one (₹)',{exact:true}).fill('30');
  await submit(owner,'Add item',`/api/canteens/${cid}/items`,400); await text(owner,'Cost to make must be less than the price');
  await form.getByLabel('Cost to make one (₹)',{exact:true}).fill('10'); await form.getByRole('radio',{name:'Cooked in a batch'}).check();
  await form.getByRole('button',{name:'Add item',exact:true}).click(); await text(owner,'Say how many get made each day, or switch to made to order');
  await form.getByLabel('Usually made per day').fill('8'); const added=await submit(owner,'Add item',`/api/canteens/${cid}/items`,201);
  let editorRow=owner.locator('tr').filter({hasText:'Browser Batch'}); await visible(editorRow);
  await goto(student,menu); await add(student,'Browser Batch',2);
  await editorRow.getByRole('button',{name:'Edit',exact:true}).click();
  await owner.getByRole('dialog').getByLabel('Name',{exact:true}).fill('Browser Batch Edited'); await owner.getByRole('dialog').getByLabel('Price (₹)',{exact:true}).fill('30');
  await submit(owner,'Save',`/api/canteens/${cid}/items/${added.item._id}`); await visible(menuRow(student,'Browser Batch Edited'));
  assert.match(await student.locator('.cart-total').innerText(),/₹60/,'cart reflects new price');
  editorRow=owner.locator('tr').filter({hasText:'Browser Batch Edited'}); await editorRow.getByRole('button',{name:'Edit',exact:true}).click();
  await owner.getByRole('dialog').getByLabel('On the menu',{exact:true}).uncheck(); await submit(owner,'Save',`/api/canteens/${cid}/items/${added.item._id}`);
  await heading(owner,'Off the menu'); await until(()=>menuRow(student,'Browser Batch Edited').count().then(n=>n===0),'removed item gone live');
  await until(()=>student.locator('.cart-lines li').count().then(n=>n===0),'removed item cleared from cart');
  assert.equal(await student.locator('.cart-bar').count(),0,'no ghost mobile count');
  step('menu editor validation, add/edit/price update, take off menu clears live and persisted cart');

  await goto(owner,staff+'/team'); await heading(owner,'Team');
  await owner.getByLabel("Who it's for (just for you)").fill('Browser cook'); await submit(owner,'Make invite link',`/api/canteens/${cid}/invites`,201);
  const inviteLink=await owner.getByLabel('Invite link',{exact:true}).inputValue(); const invited=await actor('invite');
  await invited.goto(inviteLink); await invited.waitForURL('**/login'); await invited.getByRole('link',{name:'Make an account',exact:true}).click();
  await register(invited,`invite-${Date.now()}@test.agla.app`,'Browser Cook'); await invited.waitForURL('**/invite/*'); await heading(invited,'Staff invite');
  await invited.getByRole('button',{name:'Join the team',exact:true}).click(); await invited.waitForURL(`**${staff}/kitchen`); await heading(invited,canteen.name);
  await owner.reload(); await visible(owner.getByLabel('Role for Browser Cook'));
  await owner.getByLabel('Role for Browser Cook').selectOption('manager'); await text(owner,'Role changed to manager');
  await goto(invited,staff+'/report'); await heading(invited,'Reports'); await visible(invited.locator('.report'));
  await owner.getByLabel('Role for Browser Cook').selectOption('kitchen'); await text(owner,'Role changed to kitchen');
  await goto(invited,staff+'/report'); await invited.waitForURL(`**${staff}/kitchen`); await heading(invited,canteen.name);
  expectHttp(invited,404,`/api/canteens/${cid}`); expectHttp(invited,404,`/api/canteens/${cid}/board`);
  await owner.locator('tr').filter({hasText:'Browser Cook'}).getByRole('button',{name:'Remove',exact:true}).click();
  await heading(invited,"This board isn't yours"); assert.equal(await invited.locator('.columns').count(),0,'removed staff loses cached board');
  expectHttp(invited,404,`/api/invites/${inviteLink.split('/').at(-1)}`); await invited.goto(inviteLink); await text(invited,'This invite link is invalid, expired or already used');
  // Invite decline and owner cancellation screens.
  await submit(owner,'Make invite link',`/api/canteens/${cid}/invites`,201); const declined=await owner.getByLabel('Invite link',{exact:true}).inputValue();
  await invited.goto(declined); await invited.getByRole('button',{name:'Decline',exact:true}).click(); await invited.waitForURL('**/staff');
  await owner.reload(); await submit(owner,'Make invite link',`/api/canteens/${cid}/invites`,201);
  await owner.locator('.plain-list li').last().getByRole('button',{name:'Cancel',exact:true}).click(); await text(owner,'Invite cancelled');
  step('team invite registration/return/accept, manager promotion, kitchen demotion, live removal, single-use/decline/cancel');

  for(const path of ['report','plan','menu','team','settings']) { await goto(kitchen,staff+'/'+path); await kitchen.waitForURL(`**${staff}/kitchen`); await heading(kitchen,canteen.name); }
  expectHttp(student,404,`/api/canteens/${cid}`); expectHttp(student,404,`/api/canteens/${cid}/board`);
  await goto(student,staff+'/kitchen'); await heading(student,"This board isn't yours");
  expectHttp(student,404,`/api/canteens/${cid}`); await goto(student,staff+'/report'); await heading(student,'Canteen not found');
  await goto(owner,staff+'/settings'); await heading(owner,'Hours and slots');
  await owner.getByLabel('Opens',{exact:true}).fill('18:00'); await owner.getByLabel('Closes',{exact:true}).fill('08:00');
  await submit(owner,'Save',`/api/canteens/${cid}`,400); await text(owner,'Closing time must be after opening time');
  await owner.getByLabel('Opens',{exact:true}).fill('00:00'); await owner.getByLabel('Closes',{exact:true}).fill('23:55');
  for(const label of await owner.locator('.days label').all()) if(await label.locator('input').isChecked()) await label.click();
  await submit(owner,'Save',`/api/canteens/${cid}`,400); await text(owner,'Pick at least one day the canteen is open');
  for(const label of await owner.locator('.days label').all()) if(!await label.locator('input').isChecked()) await label.click();
  await owner.getByLabel('Orders per slot',{exact:true}).fill('0'); await owner.getByRole('button',{name:'Save',exact:true}).click();
  assert.equal(await owner.getByLabel('Orders per slot',{exact:true}).evaluate(el=>el.validity.valid),false);
  await owner.getByLabel('Orders per slot',{exact:true}).fill('4'); await owner.getByLabel('Minimum time to cook',{exact:true}).fill('5');
  await submit(owner,'Save',`/api/canteens/${cid}`); await text(owner,'Saved'); await owner.reload();
  assert.equal(await owner.getByLabel('Orders per slot',{exact:true}).inputValue(),'4'); assert.equal(await owner.getByLabel('Minimum time to cook',{exact:true}).inputValue(),'5');
  step('role limits in every manager route; student staff denial; hours validation/save/reload');

  await goto(student,'/orders'); await heading(student,'My orders'); await visible(student.locator(`a[href="/orders/${first._id}"]`));
  await student.locator(`a[href="/orders/${first._id}"]`).click(); await heading(student,'Enjoy your food');
  expectHttp(second,404,`/api/orders/${first._id}`); await goto(second,`/orders/${first._id}`); await heading(second,'Order not found');
  // No-shows / unavailable online UI: fixtures create the documented restriction without waiting 45 minutes.
  const secondUser=(await api(second,'GET','/api/auth/me')).user;
  await db.collection('orders').insertMany([1,2].map(n=>({canteen:new mongoose.Types.ObjectId(cid),user:new mongoose.Types.ObjectId(secondUser._id),customer:'Browser Student',day:addDays(today,-1),token:900+n,slot:0,pickupAt:new Date(),lines:[],total:0,status:'no_show',code:'0000',requestId:`no-show-${Date.now()}-${n}`,payment:{method:'counter',status:'unpaid'},times:{placedAt:new Date(),readyAt:new Date(),noShowAt:new Date()},createdAt:new Date(),updatedAt:new Date()})));
  await goto(second,menu); await add(second,'Cutting Chai');
  await visible(second.getByText(/Online payment isn't set up at this canteen yet/));
  assert.ok(await second.getByRole('radio',{name:/Pay at the counter/}).isDisabled());
  assert.ok(await second.locator('.cart').getByRole('button').last().isDisabled());
  const missed=await db.collection('orders').findOne({user:new mongoose.Types.ObjectId(secondUser._id),status:'no_show'});
  await goto(second,`/orders/${missed._id}`); await heading(second,'You missed this pickup');
  await visible(second.getByText(/The food waited at the counter for 45 minutes/));
  step('my orders/history, order privacy, no-show ticket/restriction and online payment unavailable UI');

  // Ticket branches without a payment provider: reserve normally, then stage an unpaid online checkout.
  await goto(student,menu); await add(student,'Cutting Chai');
  const freshMenu=await api(student,'GET',`/api/canteens/menu/${canteen.slug}`);
  const paymentOrder=await order(student,freshMenu.slots.find(s=>s.open).start,cid);
  await db.collection('orders').updateOne({_id:new mongoose.Types.ObjectId(paymentOrder._id)},{$set:{status:'awaiting_payment','payment.method':'online'},$unset:{'times.placedAt':''}});
  await student.reload(); await heading(student,'Waiting for your payment');
  await text(student,'Pay within 15 minutes of ordering, or the slot and food go back to the menu.');
  assert.equal(await student.getByRole('button',{name:/^Pay ₹/}).count(),0,'no provider checkout without keys');
  await cancel(student);
  await goto(student,menu); await add(student,'Cutting Chai');
  const refundOrder=await order(student,freshMenu.slots.find(s=>s.open).start,cid);
  await db.collection('orders').updateOne({_id:new mongoose.Types.ObjectId(refundOrder._id)},{$set:{'payment.method':'online','payment.status':'paid'}});
  await student.reload(); await text(student,'Paid online');
  await slip(kitchen,refundOrder.token).getByRole('button',{name:`Cancel token ${refundOrder.token}`}).click();
  await kitchen.getByRole('dialog').getByRole('button',{name:'Cancel order',exact:true}).click();
  await heading(student,'This order was cancelled'); await text(student,'Refund on its way to your account');
  await student.reload(); await text(student,'Refund on its way to your account');
  assert.ok(invited.orderEvents.every(o=>o._id!==refundOrder._id),'removed staff socket receives no subsequent orders');
  step('staged online ticket: awaiting payment/cancel and live refund_pending without provider keys');

  // Reservation accounting still agrees with raw orders after races and cancellations.
  const todayOrders=await db.collection('orders').find({canteen:new mongoose.Types.ObjectId(cid),day:today,status:{$ne:'cancelled'}}).toArray();
  const stocks=await db.collection('stocks').find({canteen:new mongoose.Types.ObjectId(cid),day:today}).toArray();
  for(const stock of stocks) {
    const sold=todayOrders.reduce((sum,o)=>sum+o.lines.filter(l=>String(l.item)===String(stock.item)).reduce((n,l)=>n+l.qty,0),0);
    assert.equal(stock.sold,sold,`stock ledger ${stock.item}`);
  }
  const dayDoc=await db.collection('days').findOne({canteen:new mongoose.Types.ObjectId(cid),day:today});
  for(const [start,booked] of Object.entries(dayDoc.slots)) assert.equal(booked,todayOrders.filter(o=>o.slot===Number(start)).length,`slot ledger ${start}`);
  step('today stock and slot counters reconcile against raw orders after cancellations and races');

  await goto(owner,'/staff'); await heading(owner,'Staff side');
  await owner.getByLabel('Name',{exact:true}).fill(`Browser Canteen ${Date.now()}`);
  await owner.getByLabel('Where students find it').fill('Browser test block');
  const created=await submit(owner,'Add canteen','/api/canteens',201);
  await owner.waitForURL(`**/staff/${created.canteen._id}/menu`); await text(owner,'No items yet. Students see the menu exactly as you build it here.');
  await owner.getByRole('link',{name:'Reports',exact:true}).click(); await text(owner,'No orders in this period yet. Share the menu link with students to get the first ones.');
  await owner.getByRole('link',{name:'Prep plan',exact:true}).click(); await visible(owner.getByText(/No batch-cooked items/));
  step('staff home, create canteen, empty menu/reports/prep plan');
  await sleep(400);
  assert.deepEqual(errors, [], 'Unexpected browser console/network errors');
  console.log(`\nAll ${steps} browser workflow groups passed (one Chromium, five isolated contexts).`);
} catch (error) {
  console.error('FAIL:',error.stack);
  await mkdir('output/playwright',{recursive:true});
  for(const page of pages) if(!page.isClosed()) {
    await writeFile(`output/playwright/failure-${page.actorName}.txt`,await page.locator('body').innerText()).catch(()=>{});
    await page.screenshot({path:`output/playwright/failure-${page.actorName}.png`,fullPage:false}).catch(()=>{});
  }
  console.error('Browser errors:',JSON.stringify(errors,null,2));
  process.exitCode=1;
} finally {
  const finalProcesses = await browserSession.send('SystemInfo.getProcessInfo').catch(() => ({processInfo:[]}));
  console.log('Closing Chromium PIDs:', finalProcesses.processInfo.map(p=>`${p.type}:${p.id}`).join(', '));
  await browser.close(); await db.close();
}
