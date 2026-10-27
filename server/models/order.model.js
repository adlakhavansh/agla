import mongoose from "mongoose";

export const STATUSES = ["awaiting_payment", "placed", "preparing", "ready", "collected", "cancelled", "no_show"];

const lineSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true },
    // Name and price are copied at order time, so a later menu edit can't change a past order.
    name: { type: String, required: true },
    price: { type: Number, required: true },
    qty: { type: Number, required: true },
    batch: { type: Boolean, default: false },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    canteen: { type: mongoose.Schema.Types.ObjectId, ref: "Canteen", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    day: { type: String, required: true },
    // The number the counter calls out. Starts at 1 every morning.
    token: { type: Number, required: true },
    slot: { type: Number, required: true },
    pickupAt: { type: Date, required: true },
    // The student's name, copied so the kitchen board doesn't need a lookup per card.
    customer: { type: String, required: true },
    lines: { type: [lineSchema], required: true },
    total: { type: Number, required: true },
    status: { type: String, enum: STATUSES, required: true },
    // Four digits the student reads out at the counter, so nobody else walks off with the food.
    code: { type: String, required: true },
    // Sent by the browser once per checkout, so a double tap or a retry can't order twice.
    requestId: { type: String, required: true },
    payment: {
      method: { type: String, enum: ["online", "counter"], required: true },
      status: { type: String, enum: ["unpaid", "paid", "refund_pending", "refunded"], default: "unpaid" },
      razorpayOrderId: { type: String, default: null },
      razorpayPaymentId: { type: String, default: null },
      refundId: { type: String, default: null },
    },
    cancelledBy: { type: String, enum: ["student", "kitchen", "system", null], default: null },
    cancelReason: { type: String, default: null },
    times: {
      placedAt: Date,
      preparingAt: Date,
      readyAt: Date,
      collectedAt: Date,
      cancelledAt: Date,
      noShowAt: Date,
    },
  },
  { timestamps: true }
);

orderSchema.index({ canteen: 1, day: 1, status: 1 });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ user: 1, requestId: 1 }, { unique: true });
orderSchema.index({ status: 1, pickupAt: 1 });
orderSchema.index({ "payment.razorpayOrderId": 1 }, { unique: true, partialFilterExpression: { "payment.razorpayOrderId": { $type: "string" } } });

export default mongoose.model("Order", orderSchema);
