import { Link } from "react-router-dom";
import Header from "../components/Header";
import { useApi } from "../hooks/useApi";
import { rupees, clock, dayLabel, todayIST } from "../utils/format";

export const STATUS_LABEL = {
  awaiting_payment: "Waiting for payment",
  placed: "Order in",
  preparing: "Cooking",
  ready: "Ready",
  collected: "Collected",
  cancelled: "Cancelled",
  no_show: "Missed",
};

export default function Orders() {
  const { data, error, loading, reload } = useApi("/api/orders");
  const today = todayIST();

  const groups = [];
  for (const order of data?.orders ?? []) {
    const label = order.day === today ? "Today" : dayLabel(order.day);
    if (groups.at(-1)?.label !== label) groups.push({ label, orders: [] });
    groups.at(-1).orders.push(order);
  }

  return (
    <>
      <Header />
      <main className="page narrow">
        <h1 className="page-title">My orders</h1>
        {loading && !data ? (
          <p className="soft" role="status">Loading…</p>
        ) : error ? (
          <div className="notice error" role="alert"><p>{error.message}</p><button type="button" className="btn small" onClick={reload}>Try again</button></div>
        ) : groups.length === 0 ? (
          <div className="empty-block">
            <p>No orders yet.</p>
            <Link className="btn primary" to="/canteens">Order something</Link>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="order-group">
              <h2>{group.label}</h2>
              <ul className="order-list">
                {group.orders.map((order) => (
                  <li key={order._id}>
                    <Link to={`/orders/${order._id}`} className="order-row">
                      <span className="order-token">{order.token}</span>
                      <span className="order-what">
                        <strong>{order.canteen?.name}</strong>
                        <span className="soft">{order.lines.map((l) => `${l.qty} ${l.name}`).join(", ")}</span>
                      </span>
                      <span className="order-when">{clock(order.slot)}</span>
                      <span className={`status-chip s-${order.status}`}>{STATUS_LABEL[order.status]}</span>
                      <span className="num">{rupees(order.total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
    </>
  );
}
