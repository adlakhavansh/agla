import Item from "../models/item.model.js";
import Order from "../models/order.model.js";
import Stock from "../models/stock.model.js";
import { DEFAULT_COST_SHARE } from "../utils/forecast.js";
import { dayOf, addDays, clock } from "../utils/time.js";

const count = (condition) => ({ $sum: { $cond: [condition, 1, 0] } });

// The owner's view of the last 1–8 weeks: orders, money, pickup reliability, whether food is ready on time,
// what sold, when it's busy, and how much food was thrown away.
export const getReport = async (req, res) => {
  const span = Math.min(60, Math.max(7, Number.parseInt(req.query.days, 10) || 14));
  const today = dayOf();
  const from = addDays(today, -(span - 1));
  // Checkouts that were never paid don't count as orders.
  const match = { canteen: req.canteen._id, day: { $gte: from, $lte: today }, "times.placedAt": { $ne: null } };

  const [byDay, topItems, bySlot, stock, items] = await Promise.all([
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$day",
          orders: { $sum: 1 },
          collected: count({ $eq: ["$status", "collected"] }),
          noShows: count({ $eq: ["$status", "no_show"] }),
          cancelled: count({ $eq: ["$status", "cancelled"] }),
          // Online payments not refunded, plus counter orders paid at pickup.
          revenue: { $sum: { $cond: [{ $eq: ["$payment.status", "paid"] }, "$total", 0] } },
          // Of the orders that got cooked, how many were ready by the start of their slot.
          cooked: count({ $ifNull: ["$times.readyAt", false] }),
          onTime: count({ $and: [{ $ifNull: ["$times.readyAt", false] }, { $lte: ["$times.readyAt", "$pickupAt"] }] }),
        },
      },
    ]),
    Order.aggregate([
      { $match: { ...match, status: { $ne: "cancelled" } } },
      { $unwind: "$lines" },
      { $group: { _id: "$lines.item", name: { $last: "$lines.name" }, qty: { $sum: "$lines.qty" }, revenue: { $sum: { $multiply: ["$lines.price", "$lines.qty"] } } } },
      { $sort: { qty: -1 } },
      { $limit: 8 },
    ]),
    Order.aggregate([
      { $match: match },
      { $group: { _id: "$slot", orders: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    // Leftovers only exist for batch items on days that are over.
    Stock.find({ canteen: req.canteen._id, day: { $gte: from, $lt: today }, made: { $ne: null } }).lean(),
    Item.find({ canteen: req.canteen._id }).select("price cost").lean(),
  ]);

  const costOf = new Map(items.map((item) => [String(item._id), item.cost ?? Math.round(item.price * DEFAULT_COST_SHARE)]));
  const waste = new Map();
  for (const row of stock) {
    const plates = Math.max(0, row.made - row.sold);
    const day = waste.get(row.day) ?? { plates: 0, cost: 0 };
    waste.set(row.day, { plates: day.plates + plates, cost: day.cost + plates * (costOf.get(String(row.item)) ?? 0) });
  }

  const statsOf = new Map(byDay.map((row) => [row._id, row]));
  const days = Array.from({ length: span }, (_, i) => {
    const day = addDays(from, i);
    const row = statsOf.get(day);
    return {
      day,
      orders: row?.orders ?? 0,
      collected: row?.collected ?? 0,
      noShows: row?.noShows ?? 0,
      cancelled: row?.cancelled ?? 0,
      revenue: row?.revenue ?? 0,
      cooked: row?.cooked ?? 0,
      onTime: row?.onTime ?? 0,
      leftoverPlates: waste.get(day)?.plates ?? 0,
      leftoverCost: waste.get(day)?.cost ?? 0,
    };
  });

  const sum = (key) => days.reduce((total, day) => total + day[key], 0);

  res.json({
    from,
    to: today,
    totals: {
      orders: sum("orders"),
      revenue: sum("revenue"),
      noShows: sum("noShows"),
      cancelled: sum("cancelled"),
      leftoverPlates: sum("leftoverPlates"),
      leftoverCost: sum("leftoverCost"),
      onTimeRate: sum("cooked") ? sum("onTime") / sum("cooked") : null,
    },
    days,
    topItems: topItems.map((row) => ({ item: row._id, name: row.name, qty: row.qty, revenue: row.revenue })),
    slots: bySlot.map((row) => ({ slot: row._id, label: clock(row._id), orders: row.orders })),
  });
};
