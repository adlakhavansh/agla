import { useState } from "react";
import { useDispatch } from "react-redux";
import { api } from "../services/api";
import { addToast } from "../store/toastSlice";
import { WEEKDAYS } from "../utils/format";
import { useCanteen } from "./StaffLayout";

const toTime = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const toMinute = (time) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

export default function Settings() {
  const { canteen, reloadCanteen } = useCanteen();
  const dispatch = useDispatch();
  const [form, setForm] = useState({
    name: canteen.name, place: canteen.place, opensAt: toTime(canteen.opensAt), closesAt: toTime(canteen.closesAt),
    slotMinutes: canteen.slotMinutes, slotCapacity: canteen.slotCapacity, leadMinutes: canteen.leadMinutes, openDays: canteen.openDays,
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key, parse = (v) => v) => (event) => setForm((f) => ({ ...f, [key]: parse(event.target.value) }));
  const toggleDay = (day) => setForm((f) => ({ ...f, openDays: f.openDays.includes(day) ? f.openDays.filter((d) => d !== day) : [...f.openDays, day].sort() }));

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/canteens/${canteen._id}`, { ...form, opensAt: toMinute(form.opensAt), closesAt: toMinute(form.closesAt) });
      dispatch(addToast("Saved"));
      reloadCanteen();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const slotsPerDay = Math.max(0, Math.floor((toMinute(form.closesAt) - toMinute(form.opensAt)) / form.slotMinutes));

  return (
    <>
      <div className="staff-head"><h1>Hours and slots</h1></div>
      <form className="panel stack settings" onSubmit={save}>
        <div className="grid-2">
          <div className="field"><label htmlFor="sname">Canteen name</label><input id="sname" value={form.name} maxLength={60} onChange={set("name")} required /></div>
          <div className="field"><label htmlFor="splace">Where it is</label><input id="splace" value={form.place} maxLength={80} onChange={set("place")} /></div>
        </div>
        <div className="grid-2">
          <div className="field"><label htmlFor="sopen">Opens</label><input id="sopen" type="time" step="300" value={form.opensAt} onChange={set("opensAt")} required /></div>
          <div className="field"><label htmlFor="sclose">Closes</label><input id="sclose" type="time" step="300" value={form.closesAt} onChange={set("closesAt")} required /></div>
        </div>
        <fieldset className="days">
          <legend>Open on</legend>
          {WEEKDAYS.map((name, i) => (
            <label key={name} className={`chip${form.openDays.includes(i) ? " on" : ""}`}>
              <input type="checkbox" checked={form.openDays.includes(i)} onChange={() => toggleDay(i)} />{name.slice(0, 3)}
            </label>
          ))}
        </fieldset>
        <div className="grid-3">
          <div className="field">
            <label htmlFor="sslot">Pickup slot length</label>
            <select id="sslot" value={form.slotMinutes} onChange={set("slotMinutes", Number)}>
              {[5, 10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="scap">Orders per slot</label>
            <input id="scap" type="number" min="1" max="200" value={form.slotCapacity} onChange={set("slotCapacity", Number)} />
            <span className="hint">How many orders the counter can hand over in one slot.</span>
          </div>
          <div className="field">
            <label htmlFor="slead">Minimum time to cook</label>
            <input id="slead" type="number" min="0" max="120" value={form.leadMinutes} onChange={set("leadMinutes", Number)} />
            <span className="hint">Minutes. Students can't pick a slot sooner than this.</span>
          </div>
        </div>
        <p className="soft small">That makes {slotsPerDay} slots a day, up to {slotsPerDay * form.slotCapacity} orders.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="row"><button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
      </form>
    </>
  );
}
