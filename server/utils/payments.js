import crypto from "node:crypto";
import Razorpay from "razorpay";

// Online payment is optional: without keys, students can still order and pay at the counter.
export const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

export const signatureOk = (orderId, paymentId, signature) => {
  if (!process.env.RAZORPAY_KEY_SECRET) return false;
  const expected = Buffer.from(crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex"));
  const given = Buffer.from(String(signature ?? ""));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

// Razorpay's SDK rejects with { error: { description } } rather than an Error, most of the time.
export const razorpayError = (error) => error?.error?.description ?? error?.message ?? JSON.stringify(error);
