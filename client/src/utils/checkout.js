// Razorpay's checkout script, loaded the first time someone pays online.
const CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js";
let checkoutScript;

const loadCheckout = () => {
  if (window.Razorpay) return Promise.resolve();
  checkoutScript ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = setTimeout(() => fail(), 20000);
    const fail = () => {
      clearTimeout(timeout);
      script.remove();
      reject(new Error("Couldn't load the payment window. Check your connection and try again."));
    };
    script.src = CHECKOUT_URL;
    script.async = true;
    script.onload = () => {
      clearTimeout(timeout);
      if (window.Razorpay) resolve();
      else fail();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  }).catch((error) => {
    checkoutScript = null;
    throw error;
  });
  return checkoutScript;
};

// Opens Razorpay for an order and resolves with its signed result, or null if the student
// closes the window.
export const payOnline = async (checkout, canteenName) => {
  await loadCheckout();
  return new Promise((resolve) => {
    const rzp = new window.Razorpay({
      key: checkout.keyId,
      order_id: checkout.orderId,
      amount: checkout.amount,
      currency: checkout.currency,
      name: canteenName,
      description: "Agla pre-order",
      prefill: { name: checkout.name, email: checkout.email },
      theme: { color: "#17402F" },
      handler: (result) => resolve({ paymentId: result.razorpay_payment_id, signature: result.razorpay_signature }),
      modal: { ondismiss: () => resolve(null) },
    });
    // Failed attempts leave the window open so the student can retry.
    rzp.open();
  });
};
