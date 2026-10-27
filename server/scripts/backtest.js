// Replays the last 4 weeks: for each day, the prep plan is built only from data before that
// day, then compared with what the canteen actually made (the same amount every day).
//
//   node scripts/backtest.js [canteen-slug]
//
// What's known exactly: on a day an item didn't sell out, demand was what sold. On a day it
// did sell out, demand was at least what sold, so it's estimated the same way the plan
// estimates it (from that item's sales curve on normal days). The report says how often.
import "dotenv/config";
import mongoose from "mongoose";
import Canteen from "../models/canteen.model.js";
import Day from "../models/day.model.js";
import Stock from "../models/stock.model.js";
import { buildPlan, sellOutShares } from "../controllers/plan.controller.js";
import { demandOf, DEFAULT_COST_SHARE } from "../utils/forecast.js";
import { dayOf, addDays } from "../utils/time.js";

const slug = process.argv[2] ?? "block-c-canteen";
await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB || "agla" });
const canteen = await Canteen.findOne({ slug });
if (!canteen) throw new Error(`No canteen called ${slug}`);

const today = dayOf();
const days = (await Day.find({ canteen: canteen._id, day: { $gte: addDays(today, -28), $lt: today } }).sort({ day: 1 })).map((d) => d.day);

// waste: cost of food thrown away. lost: margin on plates people wanted but couldn't get.
// The plan minimises the two together, so their sum is the fair score.
const tally = () => ({ waste: 0, plates: 0, soldOut: 0, short: 0, lost: 0 });
const habit = tally();
const plan = tally();
let itemDays = 0;
let estimated = 0;

for (const day of days) {
  const { plan: rows } = await buildPlan(canteen._id, day, day);
  const actual = new Map((await Stock.find({ canteen: canteen._id, day })).map((row) => [String(row.item), row]));

  for (const row of rows) {
    const stock = actual.get(String(row.item._id));
    if (row.item.dailyLimit === null || row.suggestion === null || !stock || stock.made === null) continue;
    itemDays += 1;
    const cost = row.item.cost ?? Math.round(row.item.price * DEFAULT_COST_SHARE);

    let demand = stock.sold;
    if (stock.soldOutAt) {
      const shares = await sellOutShares(canteen._id, [stock], [...row.history.map((h) => h.day), day]);
      demand = demandOf({ sold: stock.sold, soldOut: true, shareBeforeSoldOut: shares.get(String(stock._id)) });
      estimated += 1;
    }

    const margin = row.item.price - cost;

    // What the canteen really did that day.
    habit.waste += Math.max(0, stock.made - stock.sold) * cost;
    habit.plates += Math.max(0, stock.made - stock.sold);
    if (stock.soldOutAt) {
      habit.soldOut += 1;
      habit.short += demand - stock.sold;
      habit.lost += (demand - stock.sold) * margin;
    }

    // What the plan would have done against the same demand.
    plan.waste += Math.max(0, row.suggestion - demand) * cost;
    plan.plates += Math.max(0, row.suggestion - demand);
    if (row.suggestion < demand) {
      plan.soldOut += 1;
      plan.short += demand - row.suggestion;
      plan.lost += (demand - row.suggestion) * margin;
    }
  }
}

const rupees = (paise) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
console.log(`${canteen.name}: ${days.length} trading days, ${itemDays} batch item-days, ${estimated} of them with estimated demand (the canteen sold out)\n`);
const line = (name, t) =>
  `| ${name} | ${rupees(t.waste)} (${t.plates} plates) | ${t.soldOut} | ${rupees(t.lost)} (${t.short} plates) | ${rupees(t.waste + t.lost)} |`;
console.log("| Policy | Food thrown away | Item-days sold out | Margin lost to sell-outs (est.) | Total cost of wrong quantities |");
console.log("|---|---:|---:|---:|---:|");
console.log(line("Same amount every day", habit));
console.log(line("Agla prep plan", plan));
await mongoose.disconnect();
