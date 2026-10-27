import { useState } from "react";
import Bars from "../components/Bars";
import { useApi } from "../hooks/useApi";
import { rupees, clock, dayLabel, plural } from "../utils/format";
import { useCanteen } from "./StaffLayout";

const RANGES = [7, 14, 30];

// Every slot of the day, empty ones included, so the chart reads as a real timeline.
const allSlots = (canteen, slots) => {
  const counts = new Map(slots.map((s) => [s.slot, s.orders]));
  const out = [];
  for (let slot = canteen.opensAt; slot + canteen.slotMinutes <= canteen.closesAt; slot += canteen.slotMinutes) {
    out.push({ slot, orders: counts.get(slot) ?? 0 });
  }
  return out;
};

export default function Reports() {
  const { canteen } = useCanteen();
  const [days, setDays] = useState(14);
  const { data, error, loading, reload } = useApi(`/api/canteens/${canteen._id}/report?days=${days}`);

  const short = (day) => dayLabel(day, { day: "numeric", month: "short" });
  const tickEvery = days > 14 ? 5 : days > 7 ? 2 : 1;

  return (
    <>
      <div className="staff-head">
        <h1>Reports</h1>
        <div className="chips" role="group" aria-label="Period">
          {RANGES.map((n) => (
            <button key={n} type="button" className={`chip${n === days ? " on" : ""}`} aria-pressed={n === days} onClick={() => setDays(n)}>Last {n} days</button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <p className="soft" role="status">Adding it up…</p>
      ) : error ? (
        <div className="notice error" role="alert"><p>{error.message}</p><button type="button" className="btn small" onClick={reload}>Try again</button></div>
      ) : data.totals.orders === 0 ? (
        <div className="empty-block"><p>No orders in this period yet. Share the menu link with students to get the first ones.</p></div>
      ) : (
        <div className={`report${loading ? " refreshing" : ""}`}>
          <dl className="kpis">
            <div><dt>Orders</dt><dd>{data.totals.orders.toLocaleString("en-IN")}</dd></div>
            <div><dt>Money taken</dt><dd>{rupees(data.totals.revenue)}</dd></div>
            <div><dt>Ready by pickup time</dt><dd>{data.totals.onTimeRate === null ? "–" : `${Math.round(data.totals.onTimeRate * 100)}%`}</dd></div>
            <div><dt>Missed pickups</dt><dd>{data.totals.noShows}</dd></div>
            <div><dt>Food thrown away</dt><dd>{rupees(data.totals.leftoverCost)}<small>{plural(data.totals.leftoverPlates, "plate")}</small></dd></div>
          </dl>

          <div className="report-grid">
            <section className="panel">
              <Bars
                title="Orders per day"
                data={data.days.map((d) => ({ key: d.day, label: dayLabel(d.day), tick: short(d.day), value: d.orders, note: `${rupees(d.revenue)} taken, ${d.noShows} missed` }))}
                tickEvery={tickEvery}
                height={180}
              />
            </section>
            <section className="panel">
              <Bars
                title="Busiest pickup times"
                data={allSlots(canteen, data.slots).map((s) => ({ key: s.slot, label: clock(s.slot), tick: s.slot % 120 === 0 ? clock(s.slot).replace(":00", "") : "", value: s.orders }))}
                height={180}
              />
            </section>
            <section className="panel">
              <h2 className="chart-head">What sells</h2>
              <ol className="ranked">
                {data.topItems.map((item) => (
                  <li key={item.item}>
                    <span className="ranked-name">{item.name}</span>
                    <span className="ranked-bar" aria-hidden="true"><i style={{ width: `${(item.qty / data.topItems[0].qty) * 100}%` }} /></span>
                    <span className="num">{item.qty.toLocaleString("en-IN")}</span>
                    <span className="num soft">{rupees(item.revenue)}</span>
                  </li>
                ))}
              </ol>
            </section>
            <section className="panel">
              <Bars
                title="Food thrown away"
                format={rupees}
                data={data.days.slice(0, -1).map((d) => ({ key: d.day, label: dayLabel(d.day), tick: short(d.day), value: d.leftoverCost, note: plural(d.leftoverPlates, "plate") }))}
                tickEvery={tickEvery}
                height={180}
              />
              <p className="soft small">Batch dishes left at closing, at cost. The prep plan is how this comes down.</p>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
