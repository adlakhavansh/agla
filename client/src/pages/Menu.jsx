import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import Header from "../components/Header";
import VegMark from "../components/VegMark";
import DotMatrix from "../components/DotMatrix";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import { socket } from "../services/socket";
import { setQty, clearCart } from "../store/cartSlice";
import { addToast } from "../store/toastSlice";
import { payOnline } from "../utils/checkout";
import { askToNotify } from "../utils/notify";
import { rupees, clock, plural } from "../utils/format";
import { openLine } from "./Canteens";

// One shared empty cart, so the selector returns the same object and React Redux doesn't re-render.
const EMPTY_CART = {};

function Stepper({ qty, max, onChange, name }) {
  if (qty === 0) {
    return (
      <button type="button" className="add" onClick={() => onChange(1)} disabled={max === 0} aria-label={`Add ${name}`}>
        Add
      </button>
    );
  }
  return (
    <div className="stepper" role="group" aria-label={`${name} quantity`}>
      <button type="button" onClick={() => onChange(qty - 1)} aria-label={`One less ${name}`}>−</button>
      <output aria-live="polite">{qty}</output>
      <button type="button" onClick={() => onChange(qty + 1)} disabled={qty >= max} aria-label={`One more ${name}`}>+</button>
    </div>
  );
}

function MenuRow({ item, qty, onChange }) {
  const soldOut = item.left === 0;
  const max = Math.min(10, item.left ?? 10);
  return (
    <li className={`menu-row${soldOut ? " sold-out" : ""}`}>
      <VegMark veg={item.veg} />
      <div className="menu-text">
        <p className="menu-line">
          <span className="menu-name">{item.name}</span>
          <span className="leader" aria-hidden="true" />
          <span className="menu-price">{rupees(item.price)}</span>
        </p>
        {item.description && <p className="menu-desc">{item.description}</p>}
        {soldOut ? (
          <p className="stock out">Sold out for today</p>
        ) : item.left !== null && item.left <= 10 ? (
          <p className="stock low">{item.left} left</p>
        ) : null}
      </div>
      {soldOut ? <span className="stamp" aria-hidden="true">Over</span> : <Stepper qty={qty} max={max} onChange={onChange} name={item.name} />}
    </li>
  );
}

// Slots grouped by hour, like a timetable. The bar under each time shows how full it is.
function SlotPicker({ slots, value, onChange }) {
  const upcoming = slots.filter((slot, i) => slot.open || slots.slice(i).some((s) => s.open));
  const firstOpen = upcoming.findIndex((slot) => slot.open);
  const visible = firstOpen === -1 ? [] : upcoming.slice(firstOpen);
  const hours = [];
  for (const slot of visible) {
    const hour = Math.floor(slot.start / 60);
    if (hours.at(-1)?.hour !== hour) hours.push({ hour, slots: [] });
    hours.at(-1).slots.push(slot);
  }

  if (visible.length === 0) return <p className="soft small">No pickup slots left today.</p>;

  return (
    <fieldset className="slots">
      <legend>Pickup time</legend>
      {hours.map(({ hour, slots: row }) => (
        <div className="slot-hour" key={hour}>
          <span className="slot-hour-label">{clock(hour * 60).replace(":00", "")}</span>
          <div className="slot-row">
            {row.map((slot) => {
              const fill = slot.booked / slot.capacity;
              return (
                <label key={slot.start} className={`slot${value === slot.start ? " picked" : ""}${slot.open ? "" : " full"}`}>
                  <input type="radio" name="slot" value={slot.start} checked={value === slot.start} disabled={!slot.open} onChange={() => onChange(slot.start)} />
                  <span className="slot-time">{clock(slot.start).replace(/ (am|pm)/, "")}</span>
                  <span className="slot-fill" aria-hidden="true"><i style={{ width: `${Math.min(100, fill * 100)}%` }} /></span>
                  <span className="sr-only">{slot.open ? `${slot.capacity - slot.booked} places left` : "Full"}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </fieldset>
  );
}

function Cart({ data, cart, onQty, onPlaced }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useSelector((state) => state.auth.user);
  const { canteen, items, slots, onlinePayments, me, limits } = data;
  const [slot, setSlot] = useState(null);
  const [payment, setPayment] = useState(onlinePayments ? "online" : "counter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // One id per checkout attempt: a double tap or a retry after a timeout can't order twice.
  const requestId = useRef(crypto.randomUUID());

  const lines = items.filter((item) => cart[item._id]).map((item) => ({ item, qty: cart[item._id] }));
  const total = lines.reduce((sum, line) => sum + line.item.price * line.qty, 0);
  const count = lines.reduce((sum, line) => sum + line.qty, 0);
  const slotStillOpen = slots.some((s) => s.start === slot && s.open);
  const counterBlocked = me && !me.counterAllowed;
  const tooMany = me && me.activeOrders >= limits.activeOrders;

  useEffect(() => {
    if (slot !== null && !slotStillOpen) setSlot(null);
  }, [slot, slotStillOpen]);
  useEffect(() => {
    if (counterBlocked && payment === "counter" && onlinePayments) setPayment("online");
  }, [counterBlocked, payment, onlinePayments]);

  const place = async () => {
    if (!user) {
      navigate("/login", { state: { from: location.pathname } });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { order, checkout } = await api.post(`/api/canteens/${canteen._id}/orders`, {
        lines: lines.map((line) => ({ item: line.item._id, qty: line.qty })),
        slot,
        payment,
        requestId: requestId.current,
      });
      dispatch(clearCart(canteen._id));
      requestId.current = crypto.randomUUID();
      askToNotify();

      if (checkout) {
        try {
          const result = await payOnline(checkout, canteen.name);
          if (result) await api.post(`/api/orders/${order._id}/pay`, result);
          else dispatch(addToast("Payment not finished. Your slot is held for 15 minutes; pay from the order page."));
        } catch (payError) {
          dispatch(addToast(payError.message, "error"));
        }
      }
      onPlaced();
      navigate(`/orders/${order._id}`);
    } catch (err) {
      setError(err.message);
      // Stock or slots changed under us: show the fresh menu.
      if (err.status === 409) onPlaced();
    } finally {
      setBusy(false);
    }
  };

  if (count === 0) {
    return (
      <aside className="cart empty-cart" aria-label="Your order">
        <p className="cart-title">Your order</p>
        <p className="soft small">Add something from the menu, then pick when you'll come by.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </aside>
    );
  }

  const closed = !canteen.openToday || !canteen.acceptingOrders;
  const blocked = closed || tooMany || slot === null || (payment === "counter" && counterBlocked);

  return (
    <aside className="cart" aria-label="Your order">
      <p className="cart-title">Your order <span className="soft">{plural(count, "item")}</span></p>
      <ul className="cart-lines">
        {lines.map(({ item, qty }) => (
          <li key={item._id}>
            <span>{item.name}</span>
            <Stepper qty={qty} max={Math.min(10, item.left ?? 10)} onChange={(n) => onQty(item._id, n)} name={item.name} />
            <span className="num">{rupees(item.price * qty)}</span>
          </li>
        ))}
      </ul>
      <p className="cart-total"><span>Total</span><span className="num">{rupees(total)}</span></p>

      {closed ? (
        <p className="notice">{canteen.openToday ? "The kitchen has paused new orders for a few minutes." : `${canteen.name} is closed today.`}</p>
      ) : (
        <>
          <SlotPicker slots={slots} value={slot} onChange={setSlot} />
          <fieldset className="pay">
            <legend>Payment</legend>
            {onlinePayments && (
              <label className={`pay-option${payment === "online" ? " picked" : ""}`}>
                <input type="radio" name="payment" checked={payment === "online"} onChange={() => setPayment("online")} />
                <span><strong>Pay now</strong><small>UPI or card. Refunded if you cancel before cooking starts.</small></span>
              </label>
            )}
            <label className={`pay-option${payment === "counter" ? " picked" : ""}${counterBlocked ? " off" : ""}`}>
              <input type="radio" name="payment" checked={payment === "counter"} disabled={counterBlocked} onChange={() => setPayment("counter")} />
              <span>
                <strong>Pay at the counter</strong>
                <small>
                  {counterBlocked
                    ? `Off for now: ${me.noShows} missed pickups in ${limits.noShowDays} days.`
                    : `Missing ${limits.noShows} pickups in ${limits.noShowDays} days turns this off.`}
                </small>
              </span>
            </label>
          </fieldset>
        </>
      )}

      {counterBlocked && !onlinePayments && <p className="notice">Online payment isn't set up at this canteen yet, and paying at the counter is off for you after {me.noShows} missed pickups. It comes back once they're more than {limits.noShowDays} days old.</p>}
      {tooMany && <p className="notice">You have {limits.activeOrders} orders on the way here. Collect one first.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="button" className="btn primary block" disabled={busy || (user && blocked)} onClick={place}>
        {!user ? "Log in to order" : busy ? "Placing order…" : slot === null ? "Pick a pickup time" : `Order for ${clock(slot)}, ${rupees(total)}`}
      </button>
    </aside>
  );
}

export default function Menu() {
  const { slug } = useParams();
  const dispatch = useDispatch();
  const user = useSelector((state) => state.auth.user);
  const { data, error, loading, reload } = useApi(`/api/canteens/menu/${encodeURIComponent(slug)}`);
  const canteenId = data?.canteen._id;
  const cart = useSelector((state) => (canteenId && state.carts[canteenId]) || EMPTY_CART);
  const [sheet, setSheet] = useState(false);

  // Someone else's order, a sell-out or a restock: refresh what's left. Also once a minute,
  // because slots close as the clock moves.
  useEffect(() => {
    if (!canteenId) return undefined;
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, 250);
    };
    const watch = () => socket.emit("watch-menu", { canteenId });
    const rejoin = () => { watch(); reload(); };
    if (!socket.connected) socket.connect();
    watch();
    socket.on("connect", rejoin);
    socket.on("menu", refresh);
    const minute = setInterval(reload, 60000);
    return () => {
      clearTimeout(timer);
      clearInterval(minute);
      socket.off("connect", rejoin);
      socket.off("menu", refresh);
    };
  }, [canteenId, reload]);

  // Signing in changes what the cart can do (pay at counter, order limits).
  useEffect(() => {
    if (user) reload();
  }, [user, reload]);

  // Live menu changes also apply to the saved cart: removed or sold-out dishes
  // mustn't leave hidden lines, and quantities can't exceed the plates left.
  useEffect(() => {
    if (!data) return;
    const items = new Map(data.items.map((item) => [item._id, item]));
    let changed = false;
    for (const [itemId, qty] of Object.entries(cart)) {
      const item = items.get(itemId);
      const next = item ? Math.min(qty, item.left ?? 10) : 0;
      if (next !== qty) {
        dispatch(setQty({ canteenId, itemId, qty: next }));
        changed = true;
      }
    }
    if (changed) dispatch(addToast("Your cart was updated to match what's available."));
  }, [data, cart, canteenId, dispatch]);

  const sections = useMemo(() => {
    const map = new Map();
    for (const item of data?.items ?? []) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category).push(item);
    }
    return [...map];
  }, [data]);

  if (loading && !data) return <><Header /><p className="page soft" role="status">Loading the menu…</p></>;
  if (error && !data) {
    return (
      <>
        <Header />
        <main className="empty-page">
          <h1>{error.status === 404 ? "No canteen here" : "Couldn't load the menu"}</h1>
          <p className="soft">{error.message}</p>
          <Link className="btn" to="/canteens">See canteens</Link>
        </main>
      </>
    );
  }

  const { canteen } = data;
  const onQty = (itemId, qty) => dispatch(setQty({ canteenId, itemId, qty }));
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const total = data.items.reduce((sum, item) => sum + (cart[item._id] ?? 0) * item.price, 0);
  const staff = data.me?.role;
  const low = data.items.filter((item) => item.left !== null && item.left <= 10);
  const runningLow = low.length
    ? low.map((item) => `${item.name.toUpperCase()} ${item.left === 0 ? "SOLD OUT" : `ONLY ${item.left} LEFT`}`).join("  ◆  ")
    : null;

  return (
    <>
      <Header />
      {/* The painted board over the counter, with an LED strip calling out what's running low. */}
      <header className="canteen-band">
        <div className="board-head">
          <h1>{canteen.name}</h1>
          <p className="board-meta">
            <span>{canteen.place}</span>
            <span className={`open-state${canteen.openNow && canteen.acceptingOrders ? " open" : ""}`}>{canteen.openToday ? openLine(canteen) : "Closed today"}</span>
            {staff && <Link className="staff-link" to={`/staff/${canteen._id}/kitchen`}>Open the kitchen board</Link>}
          </p>
        </div>
        {runningLow && <DotMatrix text={runningLow} pitch={5} speed={22} className="low-sign" label={`Running low: ${runningLow}`} />}
      </header>
      <main className="menu-page">
        <section className="menu-board">

          {sections.length === 0 ? (
            <p className="soft">The menu is empty for now.</p>
          ) : (
            <>
              <nav className="cats" aria-label="Menu sections">
                {sections.map(([category]) => <a key={category} href={`#cat-${category}`}>{category}</a>)}
              </nav>
              {sections.map(([category, items]) => (
                <section key={category} id={`cat-${category}`} className="menu-section" aria-labelledby={`h-${category}`}>
                  <h2 id={`h-${category}`}>{category}</h2>
                  <ul>
                    {items.map((item) => <MenuRow key={item._id} item={item} qty={cart[item._id] ?? 0} onChange={(n) => onQty(item._id, n)} />)}
                  </ul>
                </section>
              ))}
            </>
          )}
        </section>

        <div className={`cart-dock${sheet ? " open" : ""}`}>
          <Cart data={data} cart={cart} onQty={onQty} onPlaced={reload} />
        </div>
        {count > 0 && (
          <button type="button" className="cart-bar" onClick={() => setSheet((s) => !s)} aria-expanded={sheet}>
            <span>{plural(count, "item")}, {rupees(total)}</span>
            <strong>{sheet ? "Back to menu" : "Pick a pickup time"}</strong>
          </button>
        )}
      </main>
    </>
  );
}
