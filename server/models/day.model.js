import mongoose from "mongoose";

// One row per canteen per day: the token counter and how full each pickup slot is.
const daySchema = new mongoose.Schema({
  canteen: { type: mongoose.Schema.Types.ObjectId, ref: "Canteen", required: true },
  day: { type: String, required: true },
  tokenSeq: { type: Number, default: 0 },
  // Slot start minute → orders booked in it, e.g. { "750": 12 } for 12:30.
  slots: { type: Map, of: Number, default: {} },
});

daySchema.index({ canteen: 1, day: 1 }, { unique: true });

export default mongoose.model("Day", daySchema);
