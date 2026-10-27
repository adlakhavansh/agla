import { randomBytes } from "node:crypto";
import Canteen from "../models/canteen.model.js";
import Day from "../models/day.model.js";
import Item from "../models/item.model.js";
import Order from "../models/order.model.js";
import Stock from "../models/stock.model.js";
import { publicCanteen, publicItem } from "../utils/views.js";
import { slotBoard, isOpenOn } from "../utils/slots.js";
import { dayOf, minuteOf } from "../utils/time.js";
import { razorpay } from "../utils/payments.js";
import { ACTIVE } from "../utils/orders.js";
import { roleOf } from "../middlewares/canteen.middleware.js";
import { emitMenu, emitKitchen } from "../socket.js";

// Two no-shows in 30 days and a student has to pay online at this canteen.
export const NO_SHOW_LIMIT = 2;
export const NO_SHOW_DAYS = 30;
export const MAX_ACTIVE_ORDERS = 3;

export const recentNoShows = (userId, canteenId) =>
  Order.countDocuments({
    user: userId,
    canteen: canteenId,
    status: "no_show",
    "times.noShowAt": { $gt: new Date(Date.now() - NO_SHOW_DAYS * 24 * 60 * 60 * 1000) },
  });

const openNow = (canteen, now = new Date()) => {
  const minute = minuteOf(now);
  return isOpenOn(canteen, dayOf(now)) && minute >= canteen.opensAt && minute < canteen.closesAt;
};

const slugify = (name) =>
  name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "canteen";

// Anyone can browse canteens and menus without an account.
export const listCanteens = async (req, res) => {
  const canteens = await Canteen.find().sort({ name: 1 }).limit(100);
  res.json({ canteens: canteens.map((canteen) => ({ ...publicCanteen(canteen), openNow: openNow(canteen) })) });
};

// The menu page: items with how many are left today, today's slots, and, for a signed-in
// student, whether they can pay at the counter.
export const getMenu = async (req, res) => {
  const canteen = await Canteen.findOne({ slug: String(req.params.slug) });
  if (!canteen) return res.status(404).json({ message: "Canteen not found" });

  const today = dayOf();
  const [items, stock, dayDoc] = await Promise.all([
    Item.find({ canteen: canteen._id, active: true }).sort({ category: 1, name: 1 }),
    Stock.find({ canteen: canteen._id, day: today }),
    Day.findOne({ canteen: canteen._id, day: today }),
  ]);
  const stockOf = new Map(stock.map((row) => [String(row.item), row]));

  const menu = items.map((item) => {
    const row = stockOf.get(String(item._id));
    const made = row ? row.made : item.dailyLimit;
    const left = row?.closed ? 0 : made === null ? null : Math.max(0, made - (row?.sold ?? 0));
    return { ...publicItem(item), left };
  });

  let me = null;
  if (req.user) {
    const [noShows, activeOrders] = await Promise.all([
      recentNoShows(req.user._id, canteen._id),
      Order.countDocuments({ user: req.user._id, canteen: canteen._id, day: today, status: { $in: ACTIVE } }),
    ]);
    me = { noShows, counterAllowed: noShows < NO_SHOW_LIMIT, activeOrders, role: roleOf(canteen, req.user._id) };
  }

  res.json({
    canteen: { ...publicCanteen(canteen), openNow: openNow(canteen), openToday: isOpenOn(canteen, today) },
    items: menu,
    slots: isOpenOn(canteen, today) ? slotBoard(canteen, dayDoc) : [],
    onlinePayments: Boolean(razorpay),
    limits: { noShows: NO_SHOW_LIMIT, noShowDays: NO_SHOW_DAYS, activeOrders: MAX_ACTIVE_ORDERS },
    me,
  });
};

export const createCanteen = async (req, res) => {
  const { name, place } = req.body ?? {};
  if (typeof name !== "string" || !name.trim() || name.trim().length > 60) {
    return res.status(400).json({ message: "Give the canteen a name (up to 60 characters)" });
  }
  if (place !== undefined && (typeof place !== "string" || place.trim().length > 80)) {
    return res.status(400).json({ message: "Location must be 80 characters or fewer" });
  }

  const base = slugify(name);
  const slug = (await Canteen.exists({ slug: base })) ? `${base}-${randomBytes(2).toString("hex")}` : base;
  const canteen = await Canteen.create({ name: name.trim(), place: place?.trim() ?? "", slug, owner: req.user._id });
  res.status(201).json({ canteen: { ...publicCanteen(canteen), role: "owner" } });
};

// Canteens this person works at, for the staff side of the app.
export const myCanteens = async (req, res) => {
  const canteens = await Canteen.find({ $or: [{ owner: req.user._id }, { "members.user": req.user._id }] }).sort({ name: 1 });
  res.json({ canteens: canteens.map((canteen) => ({ ...publicCanteen(canteen), role: roleOf(canteen, req.user._id) })) });
};

export const getCanteen = (req, res) => {
  res.json({ canteen: { ...publicCanteen(req.canteen), role: req.role } });
};

const SLOT_LENGTHS = [5, 10, 15, 20, 30, 60];
const isMinute = (value) => Number.isInteger(value) && value >= 0 && value <= 24 * 60 && value % 5 === 0;

// Checks a settings update and returns an error message, or null when it's fine.
const settingsError = (next) => {
  if (typeof next.name !== "string" || !next.name.trim() || next.name.trim().length > 60) return "Give the canteen a name (up to 60 characters)";
  if (typeof next.place !== "string" || next.place.trim().length > 80) return "Location must be 80 characters or fewer";
  if (!isMinute(next.opensAt) || !isMinute(next.closesAt)) return "Opening and closing times must be on a 5-minute mark";
  if (next.opensAt >= next.closesAt) return "Closing time must be after opening time";
  if (!SLOT_LENGTHS.includes(next.slotMinutes)) return `Slot length must be one of ${SLOT_LENGTHS.join(", ")} minutes`;
  if (next.closesAt - next.opensAt < next.slotMinutes) return "The canteen must be open for at least one slot";
  if (!Number.isInteger(next.slotCapacity) || next.slotCapacity < 1 || next.slotCapacity > 200) return "Orders per slot must be between 1 and 200";
  if (!Number.isInteger(next.leadMinutes) || next.leadMinutes < 0 || next.leadMinutes > 120) return "Cooking time must be between 0 and 120 minutes";
  const days = next.openDays;
  if (!Array.isArray(days) || days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || new Set(days).size !== days.length) {
    return "Pick at least one day the canteen is open";
  }
  return null;
};

const SETTINGS = ["name", "place", "opensAt", "closesAt", "slotMinutes", "slotCapacity", "leadMinutes", "openDays"];

// ponytail: orders already booked keep their slot if the slot length changes; a slot grid
// that moves mid-day just won't show their old start time as bookable.
export const updateCanteen = async (req, res) => {
  const body = req.body ?? {};
  const next = Object.fromEntries(SETTINGS.map((key) => [key, body[key] === undefined ? req.canteen[key] : body[key]]));
  next.openDays = [...next.openDays];

  const error = settingsError(next);
  if (error) return res.status(400).json({ message: error });

  next.name = next.name.trim();
  next.place = next.place.trim();
  req.canteen.set(next);
  await req.canteen.save();
  emitMenu(req.canteen._id);
  res.json({ canteen: { ...publicCanteen(req.canteen), role: req.role } });
};

// Any staff member can pause new orders during a rush.
export const setAccepting = async (req, res) => {
  const { acceptingOrders } = req.body ?? {};
  if (typeof acceptingOrders !== "boolean") return res.status(400).json({ message: "acceptingOrders must be true or false" });

  req.canteen.acceptingOrders = acceptingOrders;
  await req.canteen.save();
  emitMenu(req.canteen._id);
  emitKitchen(req.canteen._id, "canteen", publicCanteen(req.canteen));
  res.json({ canteen: { ...publicCanteen(req.canteen), role: req.role } });
};
