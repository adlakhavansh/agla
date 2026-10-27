import mongoose from "mongoose";
import Item from "../models/item.model.js";
import Stock from "../models/stock.model.js";
import { ensureStock } from "../utils/reserve.js";
import { dayOf } from "../utils/time.js";
import { emitMenu, emitKitchen } from "../socket.js";

const FIELDS = ["name", "description", "category", "price", "cost", "veg", "dailyLimit", "active"];

const isPaise = (value) => Number.isInteger(value) && value >= 100 && value <= 1_000_000;
const isCount = (value) => Number.isInteger(value) && value >= 1 && value <= 2000;

// Returns an error message, or null when the item is fine.
const itemError = (item) => {
  if (typeof item.name !== "string" || !item.name.trim() || item.name.trim().length > 60) return "Name the item (up to 60 characters)";
  if (typeof item.description !== "string" || item.description.trim().length > 140) return "Description must be 140 characters or fewer";
  if (typeof item.category !== "string" || !item.category.trim() || item.category.trim().length > 30) return "Pick a category (up to 30 characters)";
  if (!isPaise(item.price)) return "Price must be between ₹1 and ₹10,000";
  if (item.cost !== null && (!Number.isInteger(item.cost) || item.cost < 0 || item.cost >= item.price)) return "Cost to make must be less than the price";
  if (typeof item.veg !== "boolean") return "Say whether the item is veg";
  if (item.dailyLimit !== null && !isCount(item.dailyLimit)) return "Daily quantity must be between 1 and 2000, or empty for made to order";
  if (typeof item.active !== "boolean") return "active must be true or false";
  return null;
};

const clean = (item) => ({ ...item, name: item.name.trim(), description: item.description.trim(), category: item.category.trim() });

const withToday = async (canteenId, items) => {
  const stock = await Stock.find({ canteen: canteenId, day: dayOf() });
  const stockOf = new Map(stock.map((row) => [String(row.item), row]));
  return items.map((item) => {
    const row = stockOf.get(String(item._id));
    // Existing staff views compare made with sold to show whether an item is sold out.
    const made = row?.closed ? row.sold : row ? row.made : item.dailyLimit;
    return { ...item.toObject(), today: { made, sold: row?.sold ?? 0, soldOutAt: row?.soldOutAt ?? null } };
  });
};

export const listItems = async (req, res) => {
  const items = await Item.find({ canteen: req.canteen._id }).sort({ active: -1, category: 1, name: 1 });
  res.json({ items: await withToday(req.canteen._id, items) });
};

export const createItem = async (req, res) => {
  const body = req.body ?? {};
  const item = { description: "", cost: null, veg: true, dailyLimit: null, active: true, ...Object.fromEntries(FIELDS.filter((key) => body[key] !== undefined).map((key) => [key, body[key]])) };

  const error = itemError(item);
  if (error) return res.status(400).json({ message: error });

  const created = await Item.create({ ...clean(item), canteen: req.canteen._id });
  emitMenu(req.canteen._id);
  res.status(201).json({ item: (await withToday(req.canteen._id, [created]))[0] });
};

// Items are switched off rather than deleted, so past orders and the prep history keep them.
export const updateItem = async (req, res) => {
  const item = mongoose.isValidObjectId(req.params.itemId) ? await Item.findOne({ _id: req.params.itemId, canteen: req.canteen._id }) : null;
  if (!item) return res.status(404).json({ message: "Item not found" });

  const body = req.body ?? {};
  const next = Object.fromEntries(FIELDS.map((key) => [key, body[key] === undefined ? item[key] : body[key]]));
  const error = itemError(next);
  if (error) return res.status(400).json({ message: error });

  item.set(clean(next));
  await item.save();
  emitMenu(req.canteen._id);
  res.json({ item: (await withToday(req.canteen._id, [item]))[0] });
};

const loadItem = (req) =>
  mongoose.isValidObjectId(req.params.itemId) ? Item.findOne({ _id: req.params.itemId, canteen: req.canteen._id }) : null;

const announceStock = async (canteenId, itemId) => {
  emitMenu(canteenId);
  emitKitchen(canteenId, "stock", await Stock.findOne({ item: itemId, day: dayOf() }));
};

// Kitchen: "we're out". Nothing more of it can be ordered today; orders already placed stand.
export const markSoldOut = async (req, res) => {
  const item = await loadItem(req);
  if (!item) return res.status(404).json({ message: "Item not found" });

  const today = dayOf();
  await ensureStock(req.canteen._id, item, today);
  await Stock.updateOne({ item: item._id, day: today }, [
    { $set: { made: "$sold", closed: true, soldOutAt: { $ifNull: ["$soldOutAt", "$$NOW"] } } },
  ], { updatePipeline: true });
  await announceStock(req.canteen._id, item._id);
  res.json({ message: `${item.name} is sold out for today` });
};

// Kitchen: "more is ready". Batch items get a number of extra plates; made-to-order items go back on.
export const restock = async (req, res) => {
  const item = await loadItem(req);
  if (!item) return res.status(404).json({ message: "Item not found" });

  const today = dayOf();
  await ensureStock(req.canteen._id, item, today);

  if (item.dailyLimit === null) {
    await Stock.updateOne({ item: item._id, day: today }, { made: null, closed: false });
  } else {
    const add = req.body?.add;
    if (!isCount(add)) return res.status(400).json({ message: "Say how many more plates are ready (1 to 2000)" });
    await Stock.updateOne({ item: item._id, day: today }, [
      { $set: { made: { $add: [{ $max: [{ $ifNull: ["$made", 0] }, "$sold"] }, add] }, closed: false } },
    ], { updatePipeline: true });
  }

  await announceStock(req.canteen._id, item._id);
  res.json({ message: `${item.name} is back on the menu` });
};
