import mongoose from "mongoose";
import { randomInt } from "node:crypto";
import Canteen from "../models/canteen.model.js";
import Item from "../models/item.model.js";
import Order from "../models/order.model.js";
import { reserveSlot, releaseSlot, reserveStock, releaseStock } from "../utils/reserve.js";
import { slotStarts, isOpenOn } from "../utils/slots.js";
import { dayOf, minuteOf, dateAt, clock } from "../utils/time.js";
import { razorpay, signatureOk, razorpayError } from "../utils/payments.js";
import { move, cancel, startRefund, ACTIVE } from "../utils/orders.js";
import { forStudent, forKitchen } from "../utils/views.js";
import { roleOf } from "../middlewares/canteen.middleware.js";
import { recentNoShows, NO_SHOW_LIMIT, NO_SHOW_DAYS, MAX_ACTIVE_ORDERS } from "./canteen.controller.js";
import { emitOrder, emitMenu } from "../socket.js";

const MAX_LINES = 10;
const MAX_QTY = 10;

const linesOk = (lines) =>
  Array.isArray(lines) &&
  lines.length >= 1 &&
  lines.length <= MAX_LINES &&
  lines.every((line) => mongoose.isValidObjectId(line?.item) && Number.isInteger(line.qty) && line.qty >= 1 && line.qty <= MAX_QTY) &&
  new Set(lines.map((line) => String(line.item))).size === lines.length;

// What the browser needs to open Razorpay's checkout for an order.
const checkoutFor = (order, user) => ({
  orderId: order.payment.razorpayOrderId,
  amount: order.total,
  currency: "INR",
  keyId: process.env.RAZORPAY_KEY_ID,
  name: user.name,
  email: user.email,
});

const replyWith = (res, status, order, user) =>
  res.status(status).json({
    order: forStudent(order),
    checkout: order.status === "awaiting_payment" && order.payment.razorpayOrderId ? checkoutFor(order, user) : null,
  });

// Checkout. Every check that can fail cheaply runs first; then the slot and the plates are
// reserved atomically, and if anything after that fails they're given back.
export const createOrder = async (req, res) => {
  const { lines, slot, payment, requestId } = req.body ?? {};

  if (typeof requestId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(requestId)) {
    return res.status(400).json({ message: "requestId is missing" });
  }
  // The same checkout sent twice (double tap, retry after a timeout) gets the first order back.
  const repeat = await Order.findOne({ user: req.user._id, requestId });
  if (repeat) return replyWith(res, 200, repeat, req.user);

  if (!linesOk(lines)) {
    return res.status(400).json({ message: `Order 1 to ${MAX_LINES} different items, up to ${MAX_QTY} of each` });
  }
  if (!["online", "counter"].includes(payment)) {
    return res.status(400).json({ message: "Choose to pay online or at the counter" });
  }

  const canteen = mongoose.isValidObjectId(req.params.canteenId) ? await Canteen.findById(req.params.canteenId) : null;
  if (!canteen) return res.status(404).json({ message: "Canteen not found" });

  const now = new Date();
  const day = dayOf(now);

  if (!isOpenOn(canteen, day)) return res.status(409).json({ message: `${canteen.name} is closed today` });
  if (!canteen.acceptingOrders) {
    return res.status(409).json({ message: "The kitchen has paused new orders for a few minutes. Try again shortly." });
  }
  if (!Number.isInteger(slot) || !slotStarts(canteen).includes(slot)) {
    return res.status(400).json({ message: "Pick a pickup slot" });
  }
  if (slot < minuteOf(now) + canteen.leadMinutes) {
    return res.status(409).json({ message: `${clock(slot)} is too soon now. Pick a later slot.` });
  }

  if (payment === "online" && !razorpay) {
    return res.status(400).json({ message: "Online payment isn't set up here yet. Pay at the counter instead." });
  }
  if (payment === "counter" && (await recentNoShows(req.user._id, canteen._id)) >= NO_SHOW_LIMIT) {
    return res.status(403).json({
      message: `You missed ${NO_SHOW_LIMIT} pickups in the last ${NO_SHOW_DAYS} days, so orders here need to be paid online for now.`,
    });
  }

  const active = await Order.countDocuments({ user: req.user._id, canteen: canteen._id, day, status: { $in: ACTIVE } });
  if (active >= MAX_ACTIVE_ORDERS) {
    return res.status(409).json({ message: `You already have ${MAX_ACTIVE_ORDERS} orders on the way here. Collect one first.` });
  }

  const items = await Item.find({ _id: { $in: lines.map((line) => line.item) }, canteen: canteen._id, active: true });
  if (items.length !== lines.length) {
    return res.status(409).json({ message: "Something in your cart is no longer on the menu. Refresh and try again." });
  }

  // Prices come from the database, never from the browser.
  const itemsById = new Map(items.map((item) => [String(item._id), item]));
  const orderLines = lines.map((line) => {
    const item = itemsById.get(String(line.item));
    return { item: item._id, name: item.name, price: item.price, qty: line.qty, batch: item.dailyLimit !== null };
  });
  const total = orderLines.reduce((sum, line) => sum + line.price * line.qty, 0);

  // Plates first, then the slot: the slot hands out the token number, so a cart that comes
  // up short doesn't use one up.
  const { short, left } = await reserveStock(canteen._id, day, orderLines, itemsById);
  if (short) {
    return res.status(409).json({
      message: left === 0 ? `${short.name} just sold out` : `Only ${left} ${short.name} left. Lower the quantity and try again.`,
    });
  }

  const token = await reserveSlot(canteen, day, slot);
  if (!token) {
    await releaseStock(day, orderLines);
    return res.status(409).json({ message: `${clock(slot)} just filled up. Pick another slot.` });
  }

  let order;
  try {
    order = await Order.create({
      canteen: canteen._id,
      user: req.user._id,
      customer: req.user.name,
      day,
      token,
      slot,
      pickupAt: dateAt(day, slot),
      lines: orderLines,
      total,
      status: payment === "online" ? "awaiting_payment" : "placed",
      code: String(randomInt(0, 10000)).padStart(4, "0"),
      requestId,
      payment: { method: payment },
      times: payment === "online" ? {} : { placedAt: now },
    });
  } catch (error) {
    await Promise.all([releaseSlot(canteen._id, day, slot), releaseStock(day, orderLines)]);
    if (error.code === 11000) {
      const first = await Order.findOne({ user: req.user._id, requestId });
      if (first) return replyWith(res, 200, first, req.user);
    }
    throw error;
  }

  emitMenu(canteen._id);

  if (payment === "online") {
    try {
      const rzp = await razorpay.orders.create({
        amount: total,
        currency: "INR",
        receipt: `agla_${order._id}`,
        notes: { order: String(order._id), canteen: canteen.name },
      });
      order = await Order.findByIdAndUpdate(order._id, { "payment.razorpayOrderId": rzp.id }, { returnDocument: "after" });
    } catch (error) {
      console.error("Razorpay order failed:", razorpayError(error));
      await cancel(order, ["awaiting_payment"], "system", "Online payment couldn't start");
      return res.status(502).json({ message: "Couldn't start the payment. Nothing was charged; try again or pay at the counter." });
    }
  } else {
    emitOrder(order);
  }

  replyWith(res, 201, order, req.user);
};

// The browser sends Razorpay's signed result; a valid signature proves the money moved.
// The sweeper recovers captured payments if the tab closes before this call.
export const verifyPayment = async (req, res) => {
  const { paymentId, signature } = req.body ?? {};
  const order = mongoose.isValidObjectId(req.params.orderId) ? await Order.findOne({ _id: req.params.orderId, user: req.user._id }) : null;
  if (!order) return res.status(404).json({ message: "Order not found" });
  if (order.payment.status !== "unpaid") return res.json({ order: forStudent(order) });

  if (typeof paymentId !== "string" || !signatureOk(order.payment.razorpayOrderId, paymentId, signature)) {
    return res.status(400).json({ message: "The payment couldn't be verified. If money left your account, it will be refunded automatically." });
  }

  // Normal case: the order was waiting for this payment.
  const placed = await move(order._id, ["awaiting_payment"], "placed", {
    "payment.status": "paid",
    "payment.razorpayPaymentId": paymentId,
  });
  if (placed) return res.json({ order: forStudent(placed) });

  // The payment arrived after the checkout expired: record it and send the money straight back.
  const late = await Order.findOneAndUpdate(
    { _id: order._id, status: "cancelled", "payment.status": "unpaid" },
    { "payment.status": "paid", "payment.razorpayPaymentId": paymentId },
    { returnDocument: "after" }
  );
  if (late) {
    const refunded = await startRefund(late);
    return res.status(409).json({ message: "This checkout had already expired, so your payment is being refunded.", order: forStudent(refunded) });
  }

  res.json({ order: forStudent(await Order.findById(order._id)) });
};

export const myOrders = async (req, res) => {
  const orders = await Order.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("canteen", "name slug place");
  res.json({ orders: orders.map(forStudent) });
};

// Students see their own orders; staff of the canteen see its orders without the pickup code.
const loadOrder = async (req) => {
  const order = mongoose.isValidObjectId(req.params.orderId) ? await Order.findById(req.params.orderId) : null;
  if (!order) return {};
  const mine = order.user.equals(req.user._id);
  const canteen = await Canteen.findById(order.canteen);
  const role = canteen && roleOf(canteen, req.user._id);
  return mine || role ? { order, mine, role } : {};
};

export const getOrder = async (req, res) => {
  const { order, mine, role } = await loadOrder(req);
  if (!order) return res.status(404).json({ message: "Order not found" });

  if (mine) {
    await order.populate("canteen", "name slug place");
    // A student who closed the payment window can finish paying from the order page.
    const checkout = order.status === "awaiting_payment" && order.payment.razorpayOrderId ? checkoutFor(order, req.user) : null;
    return res.json({ order: forStudent(order), checkout });
  }
  res.json({ order: forKitchen(order), role });
};

// A student can cancel until the kitchen starts cooking.
export const cancelMine = async (req, res) => {
  const order = mongoose.isValidObjectId(req.params.orderId) ? await Order.findOne({ _id: req.params.orderId, user: req.user._id }) : null;
  if (!order) return res.status(404).json({ message: "Order not found" });

  const cancelled = await cancel(order, ["awaiting_payment", "placed"], "student", "You cancelled this order");
  if (!cancelled) {
    const message = order.status === "cancelled" ? "This order is already cancelled" : "The kitchen has already started on this order, so it can't be cancelled now";
    return res.status(409).json({ message });
  }
  res.json({ order: forStudent(cancelled) });
};

const KITCHEN_MOVES = {
  preparing: ["placed"],
  ready: ["preparing"],
};

// Kitchen buttons: start cooking, mark ready, or cancel with a reason (refunds if paid).
export const kitchenMove = async (req, res) => {
  const { order, role } = await loadOrder(req);
  if (!order || !role) return res.status(404).json({ message: "Order not found" });

  const { to, reason } = req.body ?? {};

  if (to === "cancelled") {
    if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 120) {
      return res.status(400).json({ message: "Tell the student why (up to 120 characters)" });
    }
    const cancelled = await cancel(order, ["placed", "preparing"], "kitchen", reason.trim());
    if (!cancelled) return res.status(409).json({ message: "This order can't be cancelled any more" });
    return res.json({ order: forKitchen(cancelled) });
  }

  if (!KITCHEN_MOVES[to]) return res.status(400).json({ message: "Unknown status" });

  const moved = await move(order._id, KITCHEN_MOVES[to], to);
  if (!moved) {
    const current = await Order.findById(order._id);
    return res.status(409).json({ message: `This order is already ${current.status.replace("_", " ")}`, order: forKitchen(current) });
  }
  res.json({ order: forKitchen(moved) });
};

// The counter: the student reads out their 4-digit code and walks off with the food.
// Counter orders are paid here, so collecting one also marks it paid.
export const collectOrder = async (req, res) => {
  const { order, role } = await loadOrder(req);
  if (!order || !role) return res.status(404).json({ message: "Order not found" });

  if (order.status !== "ready") {
    return res.status(409).json({ message: `This order is ${order.status.replace("_", " ")}, not ready for pickup` });
  }
  if (String(req.body?.code ?? "") !== order.code) {
    return res.status(400).json({ message: "That code doesn't match. Ask the student to check their token." });
  }

  const collected = await move(order._id, ["ready"], "collected", order.payment.method === "counter" ? { "payment.status": "paid" } : {});
  if (!collected) return res.status(409).json({ message: "This order was just handed over" });
  res.json({ order: forKitchen(collected) });
};

// The kitchen board: everything still moving today, plus the last few finished orders.
export const board = async (req, res) => {
  const day = dayOf();
  const [live, done] = await Promise.all([
    Order.find({ canteen: req.canteen._id, day, status: { $in: ["placed", "preparing", "ready"] } }).sort({ slot: 1, token: 1 }),
    // Checkouts that were never paid never reached the kitchen, so they stay off the board.
    Order.find({ canteen: req.canteen._id, day, status: { $in: ["collected", "cancelled", "no_show"] }, "times.placedAt": { $ne: null } })
      .sort({ updatedAt: -1 })
      .limit(20),
  ]);
  res.json({ day, orders: [...live, ...done].map(forKitchen) });
};
