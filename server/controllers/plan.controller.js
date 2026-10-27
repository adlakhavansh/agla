import mongoose from "mongoose";
import Day from "../models/day.model.js";
import Item from "../models/item.model.js";
import Order from "../models/order.model.js";
import Stock from "../models/stock.model.js";
import { planItem, demandOf, RECENCY } from "../utils/forecast.js";
import { dayOf, addDays, isDay, weekdayOf, minuteOf } from "../utils/time.js";
import { ensureStock } from "../utils/reserve.js";
import { emitMenu } from "../socket.js";

const WEEKS_BACK = 8;
const MAX_AHEAD = 14;

const dayError = (day, today) => {
  if (!isDay(day) || day < today) return "Pick today or a day after it";
  if (day > addDays(today, MAX_AHEAD)) return `Plans go up to ${MAX_AHEAD} days ahead`;
  return null;
};

// For each sold-out row: on that item's normal days (when it didn't sell out), what share of
// its sales came in by the time of day it ran out. Idli sells mostly before 9:30; samosas sell
// all afternoon. So "sold out at 9:30" means a lot for samosas and very little for idli.
export const sellOutShares = async (canteenId, rows, historyDays) => {
  const soldOut = rows.filter((row) => row.soldOutAt && historyDays.includes(row.day));
  if (soldOut.length === 0) return new Map();

  const sales = await Order.aggregate([
    { $match: { canteen: canteenId, day: { $in: historyDays }, "times.placedAt": { $ne: null }, status: { $ne: "cancelled" } } },
    { $unwind: "$lines" },
    { $match: { "lines.item": { $in: [...new Set(soldOut.map((row) => row.item))] } } },
    { $project: { _id: 0, item: "$lines.item", qty: "$lines.qty", day: 1, createdAt: 1 } },
  ]);

  const soldOutDays = new Set(soldOut.map((row) => `${row.item}:${row.day}`));
  const normalSales = new Map();
  for (const sale of sales) {
    if (soldOutDays.has(`${sale.item}:${sale.day}`)) continue;
    const list = normalSales.get(String(sale.item)) ?? [];
    list.push({ minute: minuteOf(sale.createdAt), qty: sale.qty });
    normalSales.set(String(sale.item), list);
  }

  return new Map(soldOut.map((row) => {
    const list = normalSales.get(String(row.item)) ?? [];
    const total = list.reduce((sum, sale) => sum + sale.qty, 0);
    const cutoff = minuteOf(row.soldOutAt);
    const before = list.reduce((sum, sale) => sum + (sale.minute <= cutoff ? sale.qty : 0), 0);
    return [String(row._id), total ? before / total : null];
  }));
};

// For every item: the same weekday in the last 8 weeks before `day` (only days before `today`
// count), what demand probably was, and how many to make. scripts/backtest.js calls this with
// past dates to check the plan against what actually happened.
export const buildPlan = async (canteenId, day, today) => {
  const pastDays = Array.from({ length: WEEKS_BACK }, (_, i) => addDays(day, -7 * (i + 1))).filter((d) => d < today);
  // A day counts as history only if the canteen took orders on it.
  const traded = new Set((await Day.find({ canteen: canteenId, day: { $in: pastDays } }).select("day")).map((doc) => doc.day));
  const historyDays = pastDays.filter((d) => traded.has(d));

  const [items, rows] = await Promise.all([
    Item.find({ canteen: canteenId, active: true }).sort({ category: 1, name: 1 }),
    Stock.find({ canteen: canteenId, day: { $in: [...historyDays, day] } }),
  ]);
  const shares = await sellOutShares(canteenId, rows, historyDays);
  const rowOf = new Map(rows.map((row) => [`${row.item}:${row.day}`, row]));

  const plan = items.map((item) => {
    // Days before this dish existed aren't zero-demand days. Seeded/imported
    // stock can still provide real history from before the item's timestamp.
    const history = historyDays.filter((past) => rowOf.has(`${item._id}:${past}`) || past >= dayOf(item.createdAt)).map((past) => {
      const row = rowOf.get(`${item._id}:${past}`);
      const weeksAgo = Math.round((Date.parse(day) - Date.parse(past)) / (7 * 24 * 60 * 60 * 1000));
      const entry = {
        day: past,
        weeksAgo,
        sold: row?.sold ?? 0,
        made: row?.made ?? null,
        soldOut: Boolean(row?.soldOutAt),
        shareBeforeSoldOut: row ? shares.get(String(row._id)) ?? null : null,
      };
      // Sent along so the page can show the risk of any quantity the manager types in.
      return { ...entry, demand: demandOf(entry), weight: RECENCY ** (weeksAgo - 1) };
    });
    const target = rowOf.get(`${item._id}:${day}`);
    return {
      item: { _id: item._id, name: item.name, category: item.category, price: item.price, cost: item.cost, dailyLimit: item.dailyLimit },
      history,
      ...planItem({ price: item.price, cost: item.cost, history }),
      // What's set for the day right now: a saved plan, or the item's usual daily quantity.
      planned: target ? target.made : item.dailyLimit,
      saved: Boolean(target && target.made !== null),
      soldSoFar: target?.sold ?? 0,
    };
  });

  return { day, weekday: weekdayOf(day), weeksOfHistory: historyDays.length, plan };
};

// Tomorrow by default.
export const getPlan = async (req, res) => {
  const today = dayOf();
  const day = req.query.day === undefined ? addDays(today, 1) : String(req.query.day);
  const error = dayError(day, today);
  if (error) return res.status(400).json({ message: error });

  res.json(await buildPlan(req.canteen._id, day, today));
};

// Sets how many of each batch item will be made on a day. Today's number can't go below
// what students have already ordered.
export const savePlan = async (req, res) => {
  const today = dayOf();
  const { day, quantities } = req.body ?? {};
  const error = dayError(day, today);
  if (error) return res.status(400).json({ message: error });

  const valid = Array.isArray(quantities) && quantities.length >= 1 && quantities.length <= 200 &&
    quantities.every((q) => mongoose.isValidObjectId(q?.item) && Number.isInteger(q.made) && q.made >= 0 && q.made <= 2000);
  if (!valid) return res.status(400).json({ message: "Each quantity must be a whole number from 0 to 2000" });

  const items = await Item.find({ _id: { $in: quantities.map((q) => q.item) }, canteen: req.canteen._id, dailyLimit: { $ne: null } });
  if (items.length !== new Set(quantities.map((q) => String(q.item))).size) {
    return res.status(400).json({ message: "Only batch-cooked items from this canteen can be planned" });
  }

  const existing = await Stock.find({ item: { $in: items.map((item) => item._id) }, day });
  const soldOf = new Map(existing.map((row) => [String(row.item), row.sold]));
  const itemOf = new Map(items.map((item) => [String(item._id), item]));
  const tooLow = quantities.find((q) => q.made < (soldOf.get(String(q.item)) ?? 0));
  if (tooLow) {
    return res.status(409).json({ message: `${soldOf.get(String(tooLow.item))} ${itemOf.get(String(tooLow.item)).name} are already ordered, so plan at least that many` });
  }

  if (day === today) {
    for (const q of quantities) {
      const item = itemOf.get(String(q.item));
      await ensureStock(req.canteen._id, item, day);
      // An order can land after validation, so the write must also check sold.
      const result = await Stock.updateOne({ item: q.item, day, sold: { $lte: q.made } }, { $set: { made: q.made } });
      if (result.matchedCount === 0) {
        const row = await Stock.findOne({ item: q.item, day });
        return res.status(409).json({ message: `${row.sold} ${item.name} are already ordered, so plan at least that many` });
      }
    }
  } else {
    await Stock.bulkWrite(quantities.map((q) => ({
      updateOne: {
        filter: { item: q.item, day },
        update: { $set: { made: q.made }, $setOnInsert: { canteen: req.canteen._id, sold: 0 } },
        upsert: true,
      },
    })));
  }

  if (day === today) emitMenu(req.canteen._id);
  res.json({ message: day === today ? "Today's quantities updated" : "Plan saved" });
};
