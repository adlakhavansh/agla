import mongoose from "mongoose";

// Money is in paise everywhere, so ₹45.50 is 4550 and nothing rounds.
const itemSchema = new mongoose.Schema(
  {
    canteen: { type: mongoose.Schema.Types.ObjectId, ref: "Canteen", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 140, default: "" },
    category: { type: String, required: true, trim: true, maxlength: 30 },
    price: { type: Number, required: true, min: 100 },
    // What one plate costs to make. The prep plan weighs leftover cost against lost sales with it.
    cost: { type: Number, default: null },
    veg: { type: Boolean, default: true },
    // Batch-cooked items (samosa, rajma chawal) are made in a fixed quantity each day.
    // null means made to order (maggi, chai): no daily limit.
    dailyLimit: { type: Number, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Item", itemSchema);
