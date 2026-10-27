import { useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import Bars from "../components/Bars";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import { addToast } from "../store/toastSlice";
import { rupees, dayLabel, todayIST, addDays, WEEKDAYS } from "../utils/format";
import { useCanteen } from "./StaffLayout";

// How a quantity would have done on the days in history (estimated demand, recent weeks
// weighted more): how often it runs out, and what's typically left over.
const riskOf = (history, made) => {
  const total = history.reduce((sum, h) => sum + h.weight, 0);
  if (!total || !Number.isFinite(made)) return null;
  const runsOut = history.reduce((sum, h) => sum + (h.demand > made ? h.weight : 0), 0) / total;
  const leftover = history.reduce((sum, h) => sum + Math.max(0, made - h.demand) * h.weight, 0) / total;
  return { runsOut, leftover: Math.round(leftover) };
};

const oneIn = (share) => {
  if (share === 0) return "Hasn't run out";
  if (share >= 0.95) return "Almost always";
  const n = Math.round(1 / share);
  return n <= 1 ? "Most days" : `1 day in ${n}`;
};

export default function PrepPlan() {
  const { canteen } = useCanteen();
  const dispatch = useDispatch();
  const today = todayIST();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1)).filter((d) => canteen.openDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
  const [day, setDay] = useState(days[0] ?? addDays(today, 1));
  const { data, error, loading, reload } = useApi(`/api/canteens/${canteen._id}/plan?day=${day}`);
  const [made, setMade] = useState({});
  const [busy, setBusy] = useState(false);
  const disabled = busy || loading || data?.day !== day;

  const batch = useMemo(() => (data?.plan ?? []).filter((row) => row.item.dailyLimit !== null), [data]);
  const toOrder = useMemo(() => (data?.plan ?? []).filter((row) => row.item.dailyLimit === null && row.expected), [data]);

  // Start each box at the saved plan, or else the suggestion.
  useEffect(() => {
    setMade(Object.fromEntries(batch.map((row) => [row.item._id, String(row.saved ? row.planned : row.suggestion ?? row.planned ?? "")])));
  }, [batch]);

  const save = async () => {
    setBusy(true);
    try {
      const quantities = batch.filter((row) => made[row.item._id] !== "").map((row) => ({ item: row.item._id, made: Number.parseInt(made[row.item._id], 10) }));
      const result = await api.put(`/api/canteens/${canteen._id}/plan`, { day, quantities });
      dispatch(addToast(result.message));
      reload();
    } catch (err) {
      dispatch(addToast(err.message, "error"));
    } finally {
      setBusy(false);
    }
  };

  const useSuggestions = () => setMade((m) => ({ ...m, ...Object.fromEntries(batch.filter((r) => r.suggestion !== null).map((r) => [r.item._id, String(r.suggestion)])) }));

  const weekday = WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()];
  // Food thrown away on a typical day: with the numbers in the boxes, and with what the canteen makes now.
  const totals = batch.reduce((acc, row) => {
    const cost = row.item.cost ?? Math.round(row.item.price * 0.4);
    const planned = riskOf(row.history, Number.parseInt(made[row.item._id], 10));
    const habit = riskOf(row.history, row.item.dailyLimit);
    return {
      waste: acc.waste + (planned ? planned.leftover * cost : 0),
      habitWaste: acc.habitWaste + (habit ? habit.leftover * cost : 0),
    };
  }, { waste: 0, habitWaste: 0 });

  return (
    <>
      <div className="staff-head">
        <div>
          <h1>Prep plan</h1>
          <p className="soft">How much of each batch dish to cook, from the last {data?.weeksOfHistory ?? 8} {weekday}s. Each suggestion weighs throwing food away against running out, using the item's price and cost.</p>
        </div>
      </div>

      <div className="chips day-chips" role="tablist" aria-label="Day">
        {days.map((d) => (
          <button key={d} type="button" role="tab" aria-selected={d === day} className={`chip${d === day ? " on" : ""}`} onClick={() => setDay(d)}>
            {d === addDays(today, 1) ? "Tomorrow" : dayLabel(d, { weekday: "short", day: "numeric" })}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <p className="soft" role="status">Working out the plan…</p>
      ) : error ? (
        <div className="notice error" role="alert"><p>{error.message}</p><button type="button" className="btn small" onClick={reload}>Try again</button></div>
      ) : batch.length === 0 ? (
        <div className="empty-block"><p>No batch-cooked items. Mark an item as "cooked in a batch" on the Menu page to plan it here.</p></div>
      ) : (
        <>
          <div className="plan-actions">
            <p>
              Food thrown away on a typical {weekday}: <strong>{rupees(totals.waste)}</strong> with these numbers,{" "}
              against {rupees(totals.habitWaste)} with today's usual amounts.
            </p>
            <div className="row">
              <button type="button" className="btn" onClick={useSuggestions} disabled={disabled}>Use all suggestions</button>
              <button type="button" className="btn primary" onClick={save} disabled={disabled}>{busy ? "Saving…" : `Save plan for ${dayLabel(day, { weekday: "long" })}`}</button>
            </div>
          </div>
          <table className="table plan-table">
            <thead>
              <tr>
                <th scope="col">Dish</th>
                <th scope="col">Sold on past {weekday}s</th>
                <th scope="col" className="num">Typical day</th>
                <th scope="col" className="num">Suggested</th>
                <th scope="col">Make</th>
                <th scope="col">Runs out</th>
                <th scope="col" className="num">Left over</th>
              </tr>
            </thead>
            <tbody>
              {batch.map((row) => {
                const n = Number.parseInt(made[row.item._id], 10);
                const risk = riskOf(row.history, n);
                const bars = [...row.history].reverse().map((h) => ({ key: h.day, label: dayLabel(h.day, { day: "numeric", month: "short" }), value: h.sold, marked: h.soldOut }));
                return (
                  <tr key={row.item._id}>
                    <th scope="row">{row.item.name}<span className="soft small block">makes {row.item.dailyLimit} now</span></th>
                    <td className="spark-cell">
                      {row.history.length ? <Bars data={bars} height={40} compact title={`${row.item.name} sold on past ${weekday}s`} /> : <span className="soft small">No history yet</span>}
                    </td>
                    <td className="num">{row.expected ?? "–"}</td>
                    <td className="num">{row.suggestion ?? <span className="soft small">Needs 3 weeks</span>}</td>
                    <td>
                      <input
                        className="made-input"
                        type="number" min={day === today ? row.soldSoFar : 0} max="2000"
                        aria-label={`Make how many ${row.item.name}`}
                        value={made[row.item._id] ?? ""}
                        onChange={(e) => setMade((m) => ({ ...m, [row.item._id]: e.target.value }))}
                      />
                    </td>
                    <td>{risk ? oneIn(risk.runsOut) : "–"}</td>
                    <td className="num">{risk ? `${risk.leftover}` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="soft small legend-note"><span className="mark-dot inline" aria-hidden="true" /> sold out that day. Sold-out days count as higher demand than what sold, based on how early they ran out.</p>

          {toOrder.length > 0 && (
            <section className="expect">
              <h2>Made to order: what to expect</h2>
              <p className="soft small">No batch to plan, but stock up on ingredients for about this many.</p>
              <ul>
                {toOrder.map((row) => <li key={row.item._id}><span>{row.item.name}</span><strong className="num">{row.expected}</strong></li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
