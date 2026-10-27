import Day from "../models/day.model.js";
import Stock from "../models/stock.model.js";

// Two requests can race to create the same day's row; the loser's insert fails harmlessly.
const ignoreDuplicate = (error) => {
  if (error.code !== 11000) throw error;
};

// Takes one place in the slot and the next token number in one atomic update,
// so two students can never both get the last place.
export const reserveSlot = async (canteen, day, slot) => {
  await Day.updateOne({ canteen: canteen._id, day }, { $setOnInsert: { tokenSeq: 0 } }, { upsert: true }).catch(ignoreDuplicate);
  const key = `slots.${slot}`;
  const doc = await Day.findOneAndUpdate(
    { canteen: canteen._id, day, $or: [{ [key]: { $exists: false } }, { [key]: { $lt: canteen.slotCapacity } }] },
    { $inc: { [key]: 1, tokenSeq: 1 } },
    { returnDocument: "after" }
  );
  return doc?.tokenSeq ?? null;
};

export const releaseSlot = (canteenId, day, slot) =>
  Day.updateOne({ canteen: canteenId, day }, { $inc: { [`slots.${slot}`]: -1 } });

// Today's row for an item, created the first time anyone orders it.
export const ensureStock = (canteenId, item, day) =>
  Stock.updateOne({ item: item._id, day }, { $setOnInsert: { canteen: canteenId, made: item.dailyLimit } }, { upsert: true }).catch(ignoreDuplicate);

const hasRoomFor = (qty) => ({ $or: [{ made: null }, { $expr: { $lte: [{ $add: ["$sold", qty] }, "$made"] } }] });

// Each line takes its plates only if enough are left. If one comes up short, the lines
// already taken are given back and the caller hears which item ran out and how many remain.
export const reserveStock = async (canteenId, day, lines, itemsById) => {
  const taken = [];
  for (const line of lines) {
    await ensureStock(canteenId, itemsById.get(String(line.item)), day);
    const stock = await Stock.findOneAndUpdate(
      { item: line.item, day, closed: { $ne: true }, ...hasRoomFor(line.qty) },
      { $inc: { sold: line.qty } },
      { returnDocument: "after" }
    );

    if (!stock) {
      await releaseStock(day, taken);
      const current = await Stock.findOne({ item: line.item, day });
      return { short: line, left: current?.closed ? 0 : Math.max(0, (current?.made ?? 0) - (current?.sold ?? 0)) };
    }

    taken.push(line);
    // Remember when the last plate went: the prep plan reads it as "demand was higher than this".
    if (stock.made !== null && stock.sold >= stock.made && !stock.soldOutAt) {
      await Stock.updateOne({ _id: stock._id, soldOutAt: null }, { soldOutAt: new Date() });
    }
  }
  return { short: null };
};

export const releaseStock = (day, lines) =>
  Promise.all(lines.map((line) => Stock.updateOne({ item: line.item, day }, [
    { $set: { sold: { $subtract: ["$sold", line.qty] } } },
    // A rolled-back last plate isn't a sell-out in the prep history. A manual
    // closure still stands even when a cancellation returns plates.
    { $set: { soldOutAt: { $cond: [
      { $or: ["$closed", { $and: [{ $ne: ["$made", null] }, { $gte: ["$sold", "$made"] }] }] },
      "$soldOutAt", null,
    ] } } },
  ], { updatePipeline: true })));
