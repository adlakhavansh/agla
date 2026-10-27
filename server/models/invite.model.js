import mongoose from "mongoose";

const inviteSchema = new mongoose.Schema(
  {
    canteen: { type: mongoose.Schema.Types.ObjectId, ref: "Canteen", required: true },
    label: { type: String, trim: true, maxlength: 80 },
    role: { type: String, enum: ["manager", "kitchen"], required: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ["pending", "accepted", "declined"], default: "pending" },
  },
  { timestamps: true }
);

export default mongoose.model("Invite", inviteSchema);
