import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { Link, useParams } from "react-router-dom";
import Segments from "../components/Segments";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import { socket } from "../services/socket";
import { addToast } from "../store/toastSlice";
import { ding } from "../utils/notify";
import { rupees, clock, firstName } from "../utils/format";

const COLUMNS = [
  ["placed", "New", "Start cooking", "preparing"],
  ["preparing", "Cooking", "Ready", "ready"],
  ["ready", "Ready", "Hand over", null],
];
const SOON = 30; // minutes ahead the prep strip looks
const CANCEL_REASONS = ["Ran out of an item in this order", "Kitchen is closing early", "Too many orders in this slot"];

const nowMinute = () => {
  const ist = new Date(Date.now() + 330 * 60000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
};

function useMinute() {
  const [minute, setMinute] = useState(nowMinute);
  useEffect(() => {
    const timer = setInterval(() => setMinute(nowMinute()), 15000);
    return () => clearInterval(timer);
  }, []);
  return minute;
}

function Due({ slot, minute, status }) {
  const diff = slot - minute;
  if (status === "ready") return <span className="due">for {clock(slot)}</span>;
  if (diff < 0) return <span className="due late">{-diff} min late</span>;
  if (diff <= 10) return <span className="due soon">due in {diff} min</span>;
  return <span className="due">for {clock(slot)}</span>;
}

function Slip({ order, minute, action, onAction, onCancel, fresh }) {
  return (
    <li className={`slip${fresh ? " fresh" : ""}`}>
      <div className="slip-head">
        <span className="slip-token">{order.token}</span>
        <Due slot={order.slot} minute={minute} status={order.status} />
      </div>
      <ul className="slip-lines">
        {order.lines.map((line) => (
          <li key={line.item}><b>{line.qty}</b> {line.name}</li>
        ))}
      </ul>
      <div className="slip-foot">
        <span>{firstName(order.customer)}</span>
        {order.payment.method === "counter" && order.payment.status === "unpaid" && <span className="collect">Collect {rupees(order.total)}</span>}
      </div>
      <div className="slip-actions">
        <button type="button" className="slip-go" onClick={() => onAction(order)}>{action}</button>
        {order.status !== "ready" && (
          <button type="button" className="slip-x" onClick={() => onCancel(order)} aria-label={`Cancel token ${order.token}`}>Cancel</button>
        )}
      </div>
    </li>
  );
}

// The counter's keypad: the student says their 4 digits, staff tap them in.
function CodePad({ order, onClose, onDone }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const submit = useCallback(async (full) => {
    setBusy(true);
    try {
      const data = await api.post(`/api/orders/${order._id}/collect`, { code: full });
      onDone(data.order);
    } catch (err) {
      setError(err.message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }, [order._id, onDone]);

  const press = (digit) => {
    if (busy) return;
    setError(null);
    const next = (code + digit).slice(0, 4);
    setCode(next);
    if (next.length === 4) submit(next);
  };

  useEffect(() => {
    const onKey = (event) => {
      if (/^\d$/.test(event.key)) press(event.key);
      if (event.key === "Backspace") setCode((c) => c.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <dialog ref={dialog} className="codepad" onClose={onClose} aria-labelledby="codepad-title">
      <h2 id="codepad-title">Token {order.token}: ask for their code</h2>
      {order.payment.method === "counter" && order.payment.status === "unpaid" && <p className="collect big">Collect {rupees(order.total)} first</p>}
      <p className={`code-entry${error ? " wrong" : ""}`} aria-live="polite">
        {[0, 1, 2, 3].map((i) => <span key={i}>{code[i] ?? ""}</span>)}
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="keys">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <button key={d} type="button" onClick={() => press(d)}>{d}</button>)}
        <button type="button" className="key-word" onClick={() => setCode((c) => c.slice(0, -1))} aria-label="Delete last digit">Delete</button>
        <button type="button" onClick={() => press("0")}>0</button>
        <button type="button" className="key-word" onClick={() => dialog.current?.close()}>Close</button>
      </div>
    </dialog>
  );
}

function CancelDialog({ order, onClose, onDone }) {
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dialog = useRef(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await api.post(`/api/orders/${order._id}/status`, { to: "cancelled", reason });
      onDone(data.order);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="sheet-dialog" onClose={onClose} aria-labelledby="cancel-title">
      <form onSubmit={submit}>
        <h2 id="cancel-title">Cancel token {order.token}?</h2>
        <p className="soft">{firstName(order.customer)} sees the reason. {order.payment.status === "paid" ? "They're refunded automatically." : ""}</p>
        <div className="chips">
          {CANCEL_REASONS.map((r) => (
            <button key={r} type="button" className={`chip${reason === r ? " on" : ""}`} onClick={() => setReason(r)}>{r}</button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="reason">Reason</label>
          <input id="reason" value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="row">
          <button type="submit" className="btn danger" disabled={busy || !reason.trim()}>Cancel order</button>
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>Keep it</button>
        </div>
      </form>
    </dialog>
  );
}

function StockPanel({ canteenId, onClose }) {
  const dispatch = useDispatch();
  const { data, reload } = useApi(`/api/canteens/${canteenId}/items`);
  const [extra, setExtra] = useState({});

  useEffect(() => {
    // Reservations and cancellations change stock too, through the public menu
    // event. Catch up after a reconnect just like the student's menu does.
    const watch = () => socket.emit("watch-menu", { canteenId });
    const rejoin = () => { watch(); reload(); };
    watch();
    socket.on("connect", rejoin);
    socket.on("menu", reload);
    return () => {
      socket.off("connect", rejoin);
      socket.off("menu", reload);
    };
  }, [canteenId, reload]);

  const act = async (item, path, body) => {
    try {
      const result = await api.post(`/api/canteens/${canteenId}/items/${item._id}/${path}`, body);
      dispatch(addToast(result.message));
      reload();
    } catch (err) {
      dispatch(addToast(err.message, "error"));
    }
  };

  return (
    <aside className="stock-panel" aria-label="Stock">
      <div className="stock-head">
        <h2>Stock today</h2>
        <button type="button" className="btn small" onClick={onClose}>Done</button>
      </div>
      <ul>
        {(data?.items ?? []).filter((item) => item.active).map((item) => {
          const { made, sold } = item.today;
          const left = made === null ? null : Math.max(0, made - sold);
          const out = left === 0;
          return (
            <li key={item._id} className={out ? "out" : ""}>
              <span className="stock-name">{item.name}</span>
              <span className="stock-left">{left === null ? "Made to order" : out ? "Sold out" : `${left} of ${made} left`}</span>
              {out ? (
                item.dailyLimit === null ? (
                  <button type="button" className="btn small" onClick={() => act(item, "restock")}>Back on</button>
                ) : (
                  <form className="restock" onSubmit={(e) => { e.preventDefault(); act(item, "restock", { add: Number(extra[item._id] || 10) }); }}>
                    <input type="number" min="1" max="2000" aria-label={`Extra ${item.name}`} value={extra[item._id] ?? 10} onChange={(e) => setExtra((x) => ({ ...x, [item._id]: e.target.value }))} />
                    <button type="submit" className="btn small">Add plates</button>
                  </form>
                )
              ) : (
                <button type="button" className="btn small" onClick={() => act(item, "sold-out")}>Mark sold out</button>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export default function Kitchen() {
  const { canteenId } = useParams();
  const dispatch = useDispatch();
  const minute = useMinute();
  const canteenApi = useApi(`/api/canteens/${canteenId}`);
  const boardApi = useApi(`/api/canteens/${canteenId}/board`);
  const reloadBoard = boardApi.reload;
  const [orders, setOrders] = useState([]);
  const [canteen, setCanteen] = useState(null);
  const [denied, setDenied] = useState(false);
  const [fresh, setFresh] = useState(new Set());
  const [pad, setPad] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [stockOpen, setStockOpen] = useState(false);
  const [sound, setSound] = useState(true);
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  useEffect(() => {
    if (boardApi.data) setOrders(boardApi.data.orders);
  }, [boardApi.data]);
  useEffect(() => {
    if (canteenApi.data) setCanteen(canteenApi.data.canteen);
  }, [canteenApi.data]);

  const upsert = useCallback((order) => {
    if (String(order.canteen?._id ?? order.canteen) !== canteenId) return;
    setOrders((list) => {
      const known = list.some((o) => o._id === order._id);
      if (!known && order.status === "placed") {
        if (soundRef.current) ding();
        setFresh((f) => new Set(f).add(order._id));
        setTimeout(() => setFresh((f) => { const next = new Set(f); next.delete(order._id); return next; }), 8000);
      }
      return known ? list.map((o) => (o._id === order._id ? order : o)) : [...list, order];
    });
  }, [canteenId]);

  useEffect(() => {
    const watch = () => socket.emit("watch-kitchen", { canteenId }, (reply) => {
      setDenied(!reply?.ok);
      if (!reply?.ok) setOrders([]);
    });
    if (!socket.connected) socket.connect();
    watch();
    // After a reconnect, refetch so nothing that happened while offline is missed.
    const rejoin = () => { watch(); reloadBoard(); };
    socket.on("connect", rejoin);
    socket.on("rewatch", watch);
    socket.on("order", upsert);
    socket.on("canteen", setCanteen);
    return () => {
      socket.off("connect", rejoin);
      socket.off("rewatch", watch);
      socket.off("order", upsert);
      socket.off("canteen", setCanteen);
    };
  }, [canteenId, upsert, dispatch, reloadBoard]);

  const columns = useMemo(() => Object.fromEntries(COLUMNS.map(([status]) => [
    status,
    orders.filter((o) => o.status === status).sort((a, b) => a.slot - b.slot || a.token - b.token),
  ])), [orders]);

  // What to have on the stove for the next half hour, added up across orders.
  const soon = useMemo(() => {
    const counts = new Map();
    for (const order of orders) {
      if (!["placed", "preparing"].includes(order.status) || order.slot > minute + SOON) continue;
      for (const line of order.lines) counts.set(line.name, (counts.get(line.name) ?? 0) + line.qty);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [orders, minute]);

  const nowServing = useMemo(() => {
    const ready = orders.filter((o) => o.times?.readyAt && ["ready", "collected"].includes(o.status));
    return ready.sort((a, b) => new Date(b.times.readyAt) - new Date(a.times.readyAt))[0]?.token ?? null;
  }, [orders]);

  const advance = async (order, to) => {
    try {
      const data = await api.post(`/api/orders/${order._id}/status`, { to });
      upsert(data.order);
    } catch (err) {
      if (err.data?.order) upsert(err.data.order);
      dispatch(addToast(err.message, "error"));
    }
  };

  const togglePause = async () => {
    try {
      const data = await api.post(`/api/canteens/${canteenId}/accepting`, { acceptingOrders: !canteen.acceptingOrders });
      setCanteen(data.canteen);
      dispatch(addToast(data.canteen.acceptingOrders ? "Taking orders again" : "New orders paused"));
    } catch (err) {
      dispatch(addToast(err.message, "error"));
    }
  };

  const failed = canteenApi.error ?? boardApi.error;
  if (denied || (failed && !canteen)) {
    return (
      <main className="empty-page">
        <h1>{denied || failed.status === 404 ? "This board isn't yours" : "Couldn't load the board"}</h1>
        <p className="soft">{denied ? "You no longer have access to this kitchen board." : failed.message}</p>
        <Link className="btn" to="/staff">Back to staff side</Link>
      </main>
    );
  }
  if (!canteen) return <p className="empty-page" role="status">Opening the kitchen board…</p>;

  return (
    <div className="kitchen">
      <header className="kitchen-bar">
        <div className="kitchen-title">
          <Link to={canteen.role === "kitchen" ? "/staff" : `/staff/${canteenId}`} className="back" aria-label="Leave the board">‹</Link>
          <h1>{canteen.name}</h1>
        </div>
        <div className="serving" aria-label={nowServing ? `Now serving token ${nowServing}` : "Nothing ready yet"}>
          <span>Now serving</span>
          <Segments value={nowServing ?? "---"} digits={3} height={44} label="" />
        </div>
        <div className="kitchen-tools">
          <button type="button" className={`tool${canteen.acceptingOrders ? "" : " paused"}`} onClick={togglePause}>
            {canteen.acceptingOrders ? "Pause new orders" : "Orders paused. Resume"}
          </button>
          <button type="button" className="tool" onClick={() => setStockOpen((o) => !o)} aria-expanded={stockOpen}>Stock</button>
          <button type="button" className="tool" onClick={() => setSound((s) => !s)} aria-pressed={sound}>{sound ? "Sound on" : "Sound off"}</button>
          <span className="clock">{clock(minute)}</span>
        </div>
      </header>

      <section className="prep-strip" aria-label={`To cook in the next ${SOON} minutes`}>
        <span className="prep-label">Next {SOON} min</span>
        {soon.length === 0 ? (
          <span className="prep-none">Nothing due in the next {SOON} minutes.</span>
        ) : (
          soon.map(([name, qty]) => <span key={name} className="prep-chip"><b>{qty}</b> {name}</span>)
        )}
      </section>

      <div className="columns">
        {COLUMNS.map(([status, title, action, next]) => (
          <section key={status} className={`column c-${status}`} aria-labelledby={`col-${status}`}>
            <h2 id={`col-${status}`}>{title} <span className="count">{columns[status].length}</span></h2>
            {columns[status].length === 0 ? (
              <p className="column-empty">{status === "placed" ? "New orders land here." : status === "preparing" ? "Tap Start cooking on a new order." : "Ready food waits here for its code."}</p>
            ) : (
              <ul className="slips">
                {columns[status].map((order) => (
                  <Slip
                    key={order._id}
                    order={order}
                    minute={minute}
                    action={action}
                    fresh={fresh.has(order._id)}
                    onAction={(o) => (next ? advance(o, next) : setPad(o))}
                    onCancel={setCancelling}
                  />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {stockOpen && <StockPanel canteenId={canteenId} onClose={() => setStockOpen(false)} />}
      {pad && (
        <CodePad
          order={pad}
          onClose={() => setPad(null)}
          onDone={(order) => { upsert(order); setPad(null); dispatch(addToast(`Token ${order.token} handed over`)); }}
        />
      )}
      {cancelling && (
        <CancelDialog
          order={cancelling}
          onClose={() => setCancelling(null)}
          onDone={(order) => { upsert(order); setCancelling(null); dispatch(addToast(`Token ${order.token} cancelled`)); }}
        />
      )}
    </div>
  );
}
