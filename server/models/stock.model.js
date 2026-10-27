import mongoose from "mongoose";

// One row per item per day: how many were made and how many are spoken for.
// This is also the sales history the prep plan learns from.
const stockSchema = new mongoose.Schema({
  canteen: { type: mongoose.Schema.Types.ObjectId, ref: "Canteen", required: true },
  item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true },
  day: { type: String, required: true },
  // null = no limit today.
  made: { type: Number, default: null },
  sold: { type: Number, default: 0 },
  // Manual closure lasts until restock, even if cancellations return plates.
  closed: { type: Boolean, default: false },
  // Set when the last plate goes, or when the kitchen marks it sold out.
  soldOutAt: { type: Date, default: null },
});

stockSchema.index({ item: 1, day: 1 }, { unique: true });
stockSchema.index({ canteen: 1, day: 1 });

export default mongoose.model("Stock", stockSchema);
