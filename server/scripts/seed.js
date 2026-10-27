// Builds the demo: one busy campus canteen with 8 weeks of order history, a quieter night
// canteen, and three accounts to log in with. Run with --reset to rebuild it from scratch.
//
//   node scripts/seed.js --reset
//
// The history is generated, clearly a demo: weekday rhythm, meal-time peaks, and batch items
// made in fixed "habit" quantities, so some days sell out early and some leave food over.
// That gives the prep plan something real to improve on.
import "dotenv/config";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import User from "../models/user.model.js";
import Canteen from "../models/canteen.model.js";
import Item from "../models/item.model.js";
import Order from "../models/order.model.js";
import Stock from "../models/stock.model.js";
import Day from "../models/day.model.js";
import { dayOf, minuteOf, dateAt, addDays, weekdayOf } from "../utils/time.js";

const PASSWORD = "agla-demo";
const WEEKS = 8;

// A seeded random generator, so every rebuild tells the same story.
let seed = 20261027;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
const weighted = (entries) => {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = random() * total;
  for (const [value, w] of entries) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return entries.at(-1)[0];
};

// price and cost in rupees; limit = the batch size the canteen habitually makes every day, busy or not
// (null = made to order).
// when = the meals it sells at; pull = how popular it is.
const MENU = [
  ["Poha", "Breakfast", 30, 11, true, 14, ["breakfast"], 6, "Flattened rice, peanuts, curry leaves, a squeeze of lime"],
  ["Idli Sambar", "Breakfast", 40, 14, true, 12, ["breakfast"], 5, "Three idlis, sambar, coconut chutney"],
  ["Aloo Paratha", "Breakfast", 45, 16, true, null, ["breakfast", "lunch"], 5, "With curd and pickle"],
  ["Bread Omelette", "Breakfast", 40, 15, false, null, ["breakfast", "evening"], 4, "Two eggs, masala, buttered pav"],
  ["Samosa", "Snacks", 15, 6, true, 55, ["lunch", "evening"], 9, "Fresh every hour, with green chutney"],
  ["Vada Pav", "Snacks", 20, 7, true, 40, ["evening", "lunch"], 6, "Batata vada, dry garlic chutney"],
  ["Veg Puff", "Snacks", 25, 10, true, 10, ["evening"], 3, "Flaky pastry, spiced veg filling"],
  ["Bread Pakora", "Snacks", 20, 7, true, 10, ["evening"], 3, "Stuffed with aloo, fried to order in batches"],
  ["Rajma Chawal", "Meals", 70, 26, true, 30, ["lunch", "dinner"], 7, "Slow-cooked rajma, jeera rice, onion salad"],
  ["Veg Thali", "Meals", 90, 38, true, 26, ["lunch", "dinner"], 7, "Dal, two sabzi, rice, three rotis, sweet"],
  ["Egg Curry Rice", "Meals", 85, 34, false, 14, ["lunch", "dinner"], 3, "Two eggs in onion-tomato gravy"],
  ["Chole Bhature", "Meals", 80, 28, true, null, ["lunch"], 4, "Two bhature, pindi chole, pickled onion"],
  ["Paneer Kathi Roll", "Meals", 70, 30, true, null, ["evening", "dinner"], 4, "Tikka paneer, mint mayo, rumali wrap"],
  ["Masala Maggi", "Noodles", 40, 12, true, null, ["evening", "dinner", "lunch"], 8, "The one you came for"],
  ["Cheese Maggi", "Noodles", 55, 20, true, null, ["evening", "dinner"], 4, "Masala Maggi, a lot of cheese"],
  ["Veg Hakka Noodles", "Noodles", 70, 24, true, null, ["dinner", "lunch"], 3, "Wok-tossed, a little too spicy"],
  ["Cutting Chai", "Drinks", 12, 4, true, null, ["breakfast", "evening", "lunch"], 10, "Half a glass, full strength"],
  ["Filter Coffee", "Drinks", 25, 8, true, null, ["breakfast", "evening"], 4, "Decoction, frothed in a davara"],
  ["Cold Coffee", "Drinks", 50, 18, true, null, ["lunch", "evening"], 5, "Thick, with a scoop of ice cream"],
  ["Nimbu Pani", "Drinks", 20, 6, true, null, ["lunch", "evening"], 3, "Sweet, salted or both"],
];

// When people pick up, by meal, as [start minute, end minute, share of the day's orders].
const MEALS = { breakfast: [8 * 60, 10 * 60 + 30, 0.16], lunch: [12 * 60, 14 * 60 + 30, 0.44], evening: [16 * 60, 18 * 60 + 30, 0.28], dinner: [19 * 60, 21 * 60, 0.12] };
// Monday … Saturday busy-ness; Sunday the canteen is shut.
const WEEKDAY = { 1: 1.0, 2: 1.06, 3: 0.98, 4: 1.12, 5: 0.92, 6: 0.55 };
const ORDERS_ON_A_MONDAY = 300;

const FIRST = ["Aarav", "Ananya", "Vivaan", "Diya", "Aditya", "Isha", "Kabir", "Meera", "Arjun", "Saanvi", "Rohan", "Tara", "Ishaan", "Kavya", "Dev", "Nitya", "Yash", "Riya", "Aryan", "Sneha", "Kunal", "Pooja", "Siddharth", "Aditi", "Varun", "Neha", "Rahul", "Priya", "Harsh", "Anjali"];
const LAST = ["Sharma", "Iyer", "Gupta", "Reddy", "Nair", "Singh", "Patel", "Das", "Mehta", "Rao", "Joshi", "Khan", "Bose", "Menon", "Verma"];

const reset = process.argv.includes("--reset");

await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB || "agla" });

if (await Canteen.exists({ slug: "block-c-canteen" })) {
  if (!reset) {
    console.log("Demo already exists. Run with --reset to rebuild it.");
    process.exit(0);
  }
  const old = await Canteen.find({ slug: { $in: ["block-c-canteen", "night-canteen"] } });
  const ids = old.map((c) => c._id);
  await Promise.all([Item.deleteMany({ canteen: { $in: ids } }), Order.deleteMany({ canteen: { $in: ids } }), Stock.deleteMany({ canteen: { $in: ids } }), Day.deleteMany({ canteen: { $in: ids } })]);
  await Canteen.deleteMany({ _id: { $in: ids } });
  await User.deleteMany({ email: /@demo\.agla\.app$/ });
}

const hash = await bcrypt.hash(PASSWORD, 10);
const account = (name, email) => User.create({ name, email, password: hash });
const owner = await account("Meena Kulkarni", "owner@demo.agla.app");
const cook = await account("Raju Yadav", "kitchen@demo.agla.app");
const student = await account("Asha Menon", "student@demo.agla.app");
const students = [student, ...(await User.insertMany(Array.from({ length: 400 }, (_, i) => ({
  name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
  email: `student${i + 1}@demo.agla.app`,
  password: hash,
}))))];

const canteen = await Canteen.create({
  name: "Block C Canteen",
  slug: "block-c-canteen",
  place: "Ground floor, Block C, next to the library",
  owner: owner._id,
  members: [{ user: cook._id, role: "kitchen" }],
  opensAt: 8 * 60,
  closesAt: 21 * 60,
  slotMinutes: 15,
  slotCapacity: 25,
  leadMinutes: 10,
  openDays: [1, 2, 3, 4, 5, 6],
});

const items = await Item.insertMany(MENU.map(([name, category, price, cost, veg, limit, , , description]) => ({
  canteen: canteen._id, name, category, description, price: price * 100, cost: cost * 100, veg, dailyLimit: limit,
})));
const meta = new Map(MENU.map(([name, , , , , , when, pull]) => [name, { when, pull }]));

const night = await Canteen.create({
  name: "Night Canteen",
  slug: "night-canteen",
  place: "Hostel 2 gate",
  owner: owner._id,
  opensAt: 19 * 60,
  closesAt: 23 * 60 + 45,
  slotMinutes: 15,
  slotCapacity: 12,
  leadMinutes: 10,
  openDays: [0, 1, 2, 3, 4, 5, 6],
});
await Item.insertMany([
  ["Masala Maggi", "Noodles", 45], ["Cheese Maggi", "Noodles", 60], ["Bun Maska", "Snacks", 30],
  ["Egg Bhurji Pav", "Snacks", 60, false], ["Cutting Chai", "Drinks", 15], ["Hot Chocolate", "Drinks", 60],
].map(([name, category, price, veg = true]) => ({ canteen: night._id, name, category, price: price * 100, veg })));

// ── One day of orders ─────────────────────────────────────────────────────
const slotOf = (meal) => {
  const [from, to] = MEALS[meal];
  // Lunch bunches up around 13:00; other meals spread evenly.
  const minute = meal === "lunch" ? Math.round((from + to) / 2 + (random() + random() + random() - 1.5) * 50) : between(from, to - 15);
  const clamped = Math.min(Math.max(minute, canteen.opensAt), canteen.closesAt - 15);
  return clamped - (clamped % 15);
};

const today = dayOf();
const nowMinute = minuteOf();
let token = 0;

const buildDay = (day, { upTo = Infinity } = {}) => {
  const factor = WEEKDAY[weekdayOf(day)];
  if (!factor) return null;
  // Mid-term week (three weeks back): more chai and maggi, fewer thalis.
  const midterms = day >= addDays(today, -24) && day <= addDays(today, -19);
  const count = Math.round(ORDERS_ON_A_MONDAY * factor * (0.9 + random() * 0.2));
  const left = new Map(items.map((item) => [String(item._id), item.dailyLimit]));
  const soldOutAt = new Map();
  const slots = {};
  const orders = [];
  token = 0;

  const plan = Array.from({ length: count }, () => {
    const meal = weighted(Object.entries(MEALS).map(([name, [, , share]]) => [name, share]));
    const slot = slotOf(meal);
    return { meal, slot, createdMinute: Math.max(canteen.opensAt - 60, slot - between(5, 70)) };
  }).sort((a, b) => a.createdMinute - b.createdMinute);

  for (const { meal, slot, createdMinute } of plan) {
    if (createdMinute > upTo) break;
    if ((slots[slot] ?? 0) >= canteen.slotCapacity) continue;

    const choices = items.filter((item) => meta.get(item.name).when.includes(meal)).map((item) => {
      const boost = midterms && /Maggi|Chai|Coffee/.test(item.name) ? 1.6 : midterms && item.category === "Meals" ? 0.8 : 1;
      return [item, meta.get(item.name).pull * boost];
    });
    const lines = [];
    for (let n = weighted([[1, 6], [2, 3], [3, 1]]); n > 0; n--) {
      const item = weighted(choices);
      if (lines.some((line) => line.item.equals(item._id))) continue;
      const key = String(item._id);
      const qty = item.category === "Snacks" || item.name === "Cutting Chai" ? weighted([[1, 5], [2, 4], [3, 1]]) : 1;
      if (left.get(key) !== null) {
        if (left.get(key) < qty) {
          if (!soldOutAt.has(key)) soldOutAt.set(key, createdMinute);
          continue;
        }
        left.set(key, left.get(key) - qty);
        if (left.get(key) === 0) soldOutAt.set(key, createdMinute);
      }
      lines.push({ item: item._id, name: item.name, price: item.price, qty, batch: item.dailyLimit !== null });
    }
    if (lines.length === 0) continue;

    slots[slot] = (slots[slot] ?? 0) + 1;
    token += 1;
    const online = random() < 0.7;
    const createdAt = dateAt(day, createdMinute);
    const at = (offset) => dateAt(day, slot + offset);

    // How it ended. Today's orders stop wherever "now" is.
    const roll = random();
    let status = roll < 0.92 ? "collected" : roll < 0.95 ? "no_show" : roll < 0.985 ? "cancelled" : "kitchen_cancelled";
    const times = { placedAt: createdAt };
    if (day === today) {
      if (slot - nowMinute > 12) status = "placed";
      else if (slot - nowMinute > 2) status = "preparing";
      else if (nowMinute - slot < 25) status = random() < 0.6 ? "ready" : "collected";
      else if (status === "no_show" && nowMinute - slot < 45) status = "ready";
    }
    if (["preparing", "ready", "collected", "no_show"].includes(status)) times.preparingAt = at(-between(8, 14));
    if (["ready", "collected", "no_show"].includes(status)) times.readyAt = at(-between(-2, 8));
    if (status === "collected") times.collectedAt = at(between(0, 12));
    if (status === "no_show") times.noShowAt = at(45);
    if (status === "cancelled" || status === "kitchen_cancelled") times.cancelledAt = new Date(createdAt.getTime() + between(2, 10) * 60000);

    // The demo student orders about once a day and always turns up, so they can pay at the counter.
    const who = random() < 0.004 && status === "collected" ? student : pick(students.slice(1));
    const total = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
    const cancelled = status === "cancelled" || status === "kitchen_cancelled";
    orders.push({
      canteen: canteen._id,
      user: who._id,
      customer: who.name,
      day,
      token,
      slot,
      pickupAt: dateAt(day, slot),
      lines,
      total,
      status: cancelled ? "cancelled" : status,
      code: String(between(0, 9999)).padStart(4, "0"),
      requestId: `seed-${day}-${token}`,
      payment: {
        method: online ? "online" : "counter",
        status: online ? (cancelled ? "refunded" : "paid") : status === "collected" ? "paid" : "unpaid",
        razorpayOrderId: online ? `order_demo_${day.replaceAll("-", "")}_${token}` : null,
        razorpayPaymentId: online ? `pay_demo_${day.replaceAll("-", "")}_${token}` : null,
      },
      cancelledBy: status === "cancelled" ? "student" : status === "kitchen_cancelled" ? "kitchen" : null,
      cancelReason: status === "cancelled" ? "You cancelled this order" : status === "kitchen_cancelled" ? pick(["Ran out of gas for 20 minutes", "Paneer didn't arrive today", "Too many orders in this slot, sorry"]) : null,
      times,
      createdAt,
      updatedAt: times.collectedAt ?? times.noShowAt ?? times.cancelledAt ?? createdAt,
    });
  }

  // Cancelled orders gave their plates back, so stock counts only the rest.
  const sold = new Map();
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    for (const line of order.lines) sold.set(String(line.item), (sold.get(String(line.item)) ?? 0) + line.qty);
  }
  const stock = items.filter((item) => sold.has(String(item._id)) || item.dailyLimit !== null).map((item) => {
    const key = String(item._id);
    return {
      canteen: canteen._id,
      item: item._id,
      day,
      made: item.dailyLimit,
      sold: sold.get(key) ?? 0,
      soldOutAt: soldOutAt.has(key) ? dateAt(day, soldOutAt.get(key)) : null,
    };
  });

  const live = orders.filter((order) => order.status !== "cancelled");
  const slotCounts = {};
  for (const order of live) slotCounts[order.slot] = (slotCounts[order.slot] ?? 0) + 1;
  return { orders, stock, day: { canteen: canteen._id, day, tokenSeq: token, slots: slotCounts } };
};

let totalOrders = 0;
for (let back = WEEKS * 7; back >= 0; back--) {
  const day = addDays(today, -back);
  const built = buildDay(day, back === 0 ? { upTo: nowMinute } : {});
  if (!built) continue;
  await Order.insertMany(built.orders, { timestamps: false });
  if (built.stock.length) await Stock.insertMany(built.stock);
  await Day.create(built.day);
  totalOrders += built.orders.length;
}

console.log(`Seeded ${totalOrders} orders over ${WEEKS} weeks for ${canteen.name}.`);
console.log(`Log in with owner@demo.agla.app, kitchen@demo.agla.app or student@demo.agla.app, password "${PASSWORD}".`);
await mongoose.disconnect();
