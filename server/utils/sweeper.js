import Order from "../models/order.model.js";
import { move, cancel, retryRefund } from "./orders.js";
import { razorpay, razorpayError } from "./payments.js";

const MINUTE = 60 * 1000;

// A checkout nobody pays for gives its slot and plates back after this long.
export const PAYMENT_WINDOW = 15 * MINUTE;
// If Razorpay can't be asked whether an expired checkout was paid, it's released after this anyway.
export const PAYMENT_GIVE_UP = 60 * MINUTE;
// Food left on the counter this long after the slot started counts as a no-show.
export const NO_SHOW_AFTER = 45 * MINUTE;
// An order the kitchen never got to is cancelled (and refunded) this long after its slot.
export const KITCHEN_GIVE_UP = 60 * MINUTE;

let running = false;

// Runs every minute inside the API, and on POST /internal/sweep from an outside cron so a
// sleeping server catches up when it wakes. Every step is a guarded status move, so running
// it twice, or late, does nothing extra.
export const sweep = async (now = new Date()) => {
  if (running) return null;
  running = true;
  const done = { expired: 0, noShows: 0, dropped: 0, refunds: 0 };

  try {
    const unpaid = await Order.find({ status: "awaiting_payment", createdAt: { $lt: new Date(now - PAYMENT_WINDOW) } });
    for (const order of unpaid) {
      if (razorpay && order.payment.razorpayOrderId) {
        let payments;
        try {
          payments = await razorpay.orders.fetchPayments(order.payment.razorpayOrderId);
        } catch (error) {
          console.error(`Payment check for order ${order._id} failed:`, razorpayError(error));
          // Keep holding the slot while Razorpay is unreachable, but not forever.
          // ponytail: a payment captured after this gives up needs a manual refund; add webhooks if that ever happens.
          if (now - order.createdAt < PAYMENT_GIVE_UP) continue;
        }
        // A closed tab may have paid without sending its signed result.
        const captured = payments?.items.find((payment) => payment.status === "captured");
        if (captured) {
          await move(order._id, ["awaiting_payment"], "placed", {
            "payment.status": "paid",
            "payment.razorpayPaymentId": captured.id,
          });
          continue;
        }
      }
      if (await cancel(order, ["awaiting_payment"], "system", "Payment wasn't finished within 15 minutes")) done.expired++;
    }

    const uncollected = await Order.find({ status: "ready", pickupAt: { $lt: new Date(now - NO_SHOW_AFTER) } });
    for (const order of uncollected) {
      if (await move(order._id, ["ready"], "no_show")) done.noShows++;
    }

    const forgotten = await Order.find({ status: { $in: ["placed", "preparing"] }, pickupAt: { $lt: new Date(now - KITCHEN_GIVE_UP) } });
    for (const order of forgotten) {
      if (await cancel(order, ["placed", "preparing"], "system", "The kitchen couldn't get to this order in time")) done.dropped++;
    }

    const refunds = await Order.find({ "payment.status": "refund_pending" }).select("_id");
    for (const order of refunds) {
      if (await retryRefund(order._id)) done.refunds++;
    }

    return done;
  } finally {
    running = false;
  }
};
