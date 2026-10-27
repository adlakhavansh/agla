import { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { Link, useParams } from "react-router-dom";
import Header from "../components/Header";
import Segments from "../components/Segments";
import { api } from "../services/api";
import { socket } from "../services/socket";
import { addToast } from "../store/toastSlice";
import { payOnline } from "../utils/checkout";
import { ding, buzz, notify, askToNotify } from "../utils/notify";
import { rupees, clock, timeOf } from "../utils/format";

const STEPS = [
  ["placed", "Order in", "placedAt"],
  ["preparing", "Cooking", "preparingAt"],
  ["ready", "Ready at the counter", "readyAt"],
  ["collected", "Collected", "collectedAt"],
];

const HEADLINE = {
  awaiting_payment: "Waiting for your payment",
  placed: "Your order is in",
  preparing: "It's on the stove",
  ready: "Ready. Walk up to the counter.",
  collected: "Enjoy your food",
  cancelled: "This order was cancelled",
  no_show: "You missed this pickup",
};

const paymentLine = (order) => {
  const { method, status } = order.payment;
  if (status === "refund_pending") return "Refund on its way to your account";
  if (status === "refunded") return `${rupees(order.total)} refunded`;
  if (method === "online") return status === "paid" ? "Paid online" : "Not paid yet";
  return status === "paid" ? "Paid at the counter" : `Pay ${rupees(order.total)} at the counter`;
};

export default function Ticket() {
  const { orderId } = useParams();
  const dispatch = useDispatch();
  const [state, setState] = useState({ order: null, checkout: null, error: null });
  const [busy, setBusy] = useState(false);
  // The full-screen "your number is up" moment, until the student closes it.
  const [calledOut, setCalledOut] = useState(true);
  const lastStatus = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.get(`/api/orders/${orderId}`)
        .then((data) => alive && setState({ order: data.order, checkout: data.checkout, error: null }))
        .catch((error) => alive && setState((s) => ({ ...s, error })));
    load();
    const onOrder = (order) => {
      if (order._id !== orderId) return;
      setState((s) => ({ ...s, order: { ...order, canteen: s.order?.canteen ?? order.canteen }, checkout: order.status === "awaiting_payment" ? s.checkout : null }));
    };
    if (!socket.connected) socket.connect();
    socket.on("order", onOrder);
    // Catch up on anything missed while the socket was down (phone asleep, tunnel, lift).
    socket.on("connect", load);
    return () => {
      alive = false;
      socket.off("order", onOrder);
      socket.off("connect", load);
    };
  }, [orderId]);

  const { order, checkout, error } = state;

  useEffect(() => {
    if (!order) return;
    if (lastStatus.current && lastStatus.current !== "ready" && order.status === "ready") {
      setCalledOut(true);
      ding();
      buzz();
      notify(`Token ${order.token} is ready`, `Collect it at ${order.canteen?.name ?? "the counter"}. Your code is ${order.code}.`);
    }
    lastStatus.current = order.status;
  }, [order]);

  if (error && !order) {
    return (
      <>
        <Header />
        <main className="empty-page">
          <h1>{error.status === 404 ? "Order not found" : "Couldn't load this order"}</h1>
          <p className="soft">{error.message}</p>
          <Link className="btn" to="/orders">My orders</Link>
        </main>
      </>
    );
  }
  if (!order) return <><Header /><p className="page soft" role="status">Loading your order…</p></>;

  const cancel = async () => {
    setBusy(true);
    try {
      const data = await api.post(`/api/orders/${order._id}/cancel`);
      setState((s) => ({ ...s, order: { ...data.order, canteen: s.order.canteen }, checkout: null }));
      dispatch(addToast(data.order.payment.status === "unpaid" ? "Order cancelled" : "Order cancelled. Your refund is on its way."));
    } catch (err) {
      dispatch(addToast(err.message, "error"));
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    setBusy(true);
    try {
      const result = await payOnline(checkout, order.canteen?.name ?? "Agla");
      if (result) {
        const data = await api.post(`/api/orders/${order._id}/pay`, result);
        setState((s) => ({ ...s, order: { ...data.order, canteen: s.order.canteen }, checkout: null }));
      }
    } catch (err) {
      dispatch(addToast(err.message, "error"));
    } finally {
      setBusy(false);
    }
  };

  const ended = ["cancelled", "no_show"].includes(order.status);
  const reached = STEPS.findIndex(([status]) => status === order.status);

  return (
    <>
      <Header />
      <main className={`ticket status-${order.status}`}>
        <section className="token-board" aria-live="polite">
          <div className="token-housing">
            <span className="token-label">Token</span>
            <Segments value={order.token} digits={3} height={92} className={order.status === "ready" ? "blink" : ""} />
          </div>
          <h1>{HEADLINE[order.status]}</h1>
          {order.canteen?.name && (
            <p className="soft">{order.canteen.name}{order.canteen.place ? `, ${order.canteen.place}` : ""}</p>
          )}
        </section>

        {!ended && order.status !== "collected" && (
          <section className="code-card">
            <p>Pickup at <strong>{clock(order.slot)}</strong></p>
            <p className="code-label">Say this code at the counter</p>
            <p className="code" aria-label={`Pickup code ${[...order.code].join(" ")}`}>
              {[...order.code].map((digit, i) => <span key={i}>{digit}</span>)}
            </p>
          </section>
        )}

        {order.status === "awaiting_payment" && (
          <section className="notice">
            <p>Pay within 15 minutes of ordering, or the slot and food go back to the menu.</p>
            <div className="row">
              {checkout && <button type="button" className="btn primary" onClick={pay} disabled={busy}>Pay {rupees(order.total)}</button>}
              <button type="button" className="btn" onClick={cancel} disabled={busy}>Cancel order</button>
            </div>
          </section>
        )}

        {ended ? (
          <section className="notice">
            <p>
              {order.status === "no_show"
                ? "The food waited at the counter for 45 minutes after your slot. Missing two pickups in 30 days turns off paying at the counter here."
                : order.cancelReason}
            </p>
          </section>
        ) : order.status !== "awaiting_payment" && (
          <ol className="progress">
            {STEPS.map(([status, label, time], i) => (
              <li key={status} className={i < reached ? "done" : i === reached ? "now" : ""}>
                <span className="progress-label">{label}</span>
                {order.times?.[time] && <span className="progress-time">{timeOf(order.times[time])}</span>}
              </li>
            ))}
          </ol>
        )}

        <section className="receipt">
          <ul>
            {order.lines.map((line) => (
              <li key={line.item}>
                <span>{line.qty} × {line.name}</span>
                <span className="num">{rupees(line.price * line.qty)}</span>
              </li>
            ))}
          </ul>
          <p className="receipt-total"><span>{paymentLine(order)}</span><span className="num">{rupees(order.total)}</span></p>
        </section>

        {order.status === "ready" && calledOut && (
          <div className="called-out" role="alertdialog" aria-labelledby="called-title" aria-describedby="called-code">
            <p className="called-shout" aria-hidden="true">Agla!</p>
            <div className="token-housing big">
              <span className="token-label">Now serving</span>
              <Segments value={order.token} digits={3} height={168} className="blink" />
            </div>
            <h2 id="called-title">Token {order.token}, your food is ready</h2>
            <p id="called-code" className="called-code">
              <strong>{[...order.code].join(" ")}</strong>
              Say your code at the counter{order.canteen?.name ? ` of ${order.canteen.name}` : ""}
            </p>
            <button type="button" className="btn turmeric big" onClick={() => setCalledOut(false)} autoFocus>On my way</button>
          </div>
        )}

        <div className="row ticket-actions">
          {order.status === "placed" && <button type="button" className="btn" onClick={cancel} disabled={busy}>Cancel order</button>}
          {["placed", "preparing"].includes(order.status) && "Notification" in window && Notification.permission === "default" && (
            <button type="button" className="btn" onClick={askToNotify}>Tell me when it's ready</button>
          )}
          {order.canteen?.slug && <Link className="btn ghost" to={`/c/${order.canteen.slug}`}>Back to the menu</Link>}
        </div>
      </main>
    </>
  );
}
