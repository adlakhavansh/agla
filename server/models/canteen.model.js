import mongoose from "mongoose";

const memberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // manager: menu, hours, prep plan, reports, team. kitchen: the order board and the counter.
    role: { type: String, enum: ["manager", "kitchen"], required: true },
  },
  { _id: false }
);

// Times are minutes after midnight, IST (see utils/time.js).
const canteenSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true, unique: true },
    place: { type: String, trim: true, maxlength: 80, default: "" },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    members: [memberSchema],
    opensAt: { type: Number, default: 8 * 60 },
    closesAt: { type: Number, default: 20 * 60 },
    slotMinutes: { type: Number, default: 15 },
    // How many orders the kitchen can hand over in one slot.
    slotCapacity: { type: Number, default: 20 },
    // The earliest slot you can pick is at least this far away, so the kitchen has time to cook.
    leadMinutes: { type: Number, default: 10 },
    // 0 = Sunday … 6 = Saturday.
    openDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
    // The kitchen can pause new orders during a rush without closing the canteen.
    acceptingOrders: { type: Boolean, default: true },
  },
  { timestamps: true }
);

canteenSchema.index({ "members.user": 1 });

export default mongoose.model("Canteen", canteenSchema);
