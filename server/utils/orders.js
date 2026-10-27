import Order from "../models/order.model.js";
import { releaseSlot, releaseStock } from "./reserve.js";
import { razorpay, razorpayError } from "./payments.js";
import { emitOrder, emitMenu } from "../socket.js";

// awaiting_payment → placed → preparing → ready → collected
//        ↓              ↓          ↓          ↓
//    cancelled      cancelled  cancelled   no_show
const TIME_OF = {
  placed: "placedAt",
  preparing: "preparingAt",
  ready: "readyAt",
  collected: "collectedAt",
  cancelled: "cancelledAt",
  no_show: "noShowAt",
};

export const ACTIVE = ["awaiting_payment", "placed", "preparing", "ready"];

// The only way an order changes status. Filtering on the current status makes every move
// happen once: if two staff tap "Ready" together, the second tap finds nothing to update.
export const move = async (orderId, from, to, set = {}) => {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, status: { $in: from } },
    { $set: { status: to, [`times.${TIME_OF[to]}`]: new Date(), ...set } },
    { returnDocument: "after" }
  );
  if (order) emitOrder(order);
  return order;
};

// Cancelling gives the slot and the plates back, and refunds the student if they paid.
export const cancel = async (order, from, by, reason) => {
  const cancelled = await move(order._id, from, "cancelled", { cancelledBy: by, cancelReason: reason });
  if (!cancelled) return null;

  let result = cancelled;
  try {
    await Promise.all([releaseSlot(cancelled.canteen, cancelled.day, cancelled.slot), releaseStock(cancelled.day, cancelled.lines)]);
    emitMenu(cancelled.canteen);
  } finally {
    // A reservation failure mustn't leave the student's money behind.
    if (cancelled.payment.status === "paid") result = await startRefund(cancelled);
  }
  return result;
};

export const startRefund = async (order) => {
  const pending = await Order.findOneAndUpdate(
    { _id: order._id, "payment.status": "paid" },
    { "payment.status": "refund_pending" },
    { returnDocument: "after" }
  );
  if (pending) emitOrder(pending);
  return (await retryRefund(order._id)) ?? Order.findById(order._id);
};

// A refund that fails stays refund_pending and the sweeper tries again every minute.
// Reuse an existing refund so a lost response doesn't start another one.
export const retryRefund = async (orderId) => {
  if (!razorpay) return null;
  const order = await Order.findOne({ _id: orderId, "payment.status": "refund_pending" });
  if (!order) return null;

  try {
    const paymentId = order.payment.razorpayPaymentId;
    const refunds = await razorpay.payments.fetchMultipleRefund(paymentId);
    // A failed refund returned nothing, so it doesn't count; start a fresh one.
    const refund = refunds.items.find((r) => r.status !== "failed") ?? await razorpay.payments.refund(paymentId, {
      amount: order.total,
      notes: { order: String(order._id) },
    });
    const refunded = await Order.findOneAndUpdate(
      { _id: order._id, "payment.status": "refund_pending" },
      { "payment.status": refund.status === "processed" ? "refunded" : "refund_pending", "payment.refundId": refund.id },
      { returnDocument: "after" }
    );
    if (refunded) emitOrder(refunded);
    return refunded;
  } catch (error) {
    console.error(`Refund for order ${order._id} failed, will retry:`, razorpayError(error));
    return null;
  }
};
