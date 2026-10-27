import { Link } from "react-router-dom";
import Header from "../components/Header";
import { useApi } from "../hooks/useApi";
import { clock } from "../utils/format";

export const openLine = (canteen) => {
  if (!canteen.acceptingOrders && canteen.openNow) return "Open, but the kitchen has paused new orders";
  if (canteen.openNow) return `Open until ${clock(canteen.closesAt)}`;
  return `Opens ${clock(canteen.opensAt)}`;
};

export default function Canteens() {
  const { data, error, loading, reload } = useApi("/api/canteens");

  return (
    <>
      <Header />
      <main className="page narrow">
        <h1 className="page-title">Where are you eating?</h1>
        {loading && !data ? (
          <p className="soft" role="status">Loading canteens…</p>
        ) : error ? (
          <div className="notice error" role="alert">
            <p>{error.message}</p>
            <button type="button" className="btn small" onClick={reload}>Try again</button>
          </div>
        ) : data.canteens.length === 0 ? (
          <p className="soft">No canteens on Agla yet. Run one? <Link to="/staff">Set it up</Link>.</p>
        ) : (
          <ul className="canteen-list">
            {data.canteens.map((canteen) => (
              <li key={canteen._id}>
                <Link to={`/c/${canteen.slug}`} className="canteen-row">
                  <span className={`dot ${canteen.openNow && canteen.acceptingOrders ? "open" : ""}`} aria-hidden="true" />
                  <span className="canteen-name">{canteen.name}</span>
                  <span className="canteen-place">{canteen.place}</span>
                  <span className="canteen-open">{openLine(canteen)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
