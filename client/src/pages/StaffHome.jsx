import { useState } from "react";
import { useDispatch } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import { addToast } from "../store/toastSlice";

const ROLE = { owner: "Owner", manager: "Manager", kitchen: "Kitchen" };

// Where staff land: the canteens they work at, and a way to put a new one on Agla.
export default function StaffHome() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi("/api/canteens/mine");
  const [form, setForm] = useState({ name: "", place: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  const create = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const { canteen } = await api.post("/api/canteens", form);
      dispatch(addToast(`${canteen.name} is on Agla. Add the menu next.`));
      navigate(`/staff/${canteen._id}/menu`);
    } catch (err) {
      setFormError(err.message);
      setBusy(false);
    }
  };

  return (
    <>
      <Header />
      <main className="page narrow">
        <h1 className="page-title">Staff side</h1>
        {loading && !data ? (
          <p className="soft" role="status">Loading…</p>
        ) : error ? (
          <div className="notice error" role="alert"><p>{error.message}</p><button type="button" className="btn small" onClick={reload}>Try again</button></div>
        ) : data.canteens.length === 0 ? (
          <p className="soft">You don't work at any canteen on Agla yet. Got an invite link? Open it while logged in. Running a canteen? Add it below.</p>
        ) : (
          <ul className="staff-list">
            {data.canteens.map((canteen) => (
              <li key={canteen._id}>
                <div>
                  <strong>{canteen.name}</strong>
                  <span className="soft">{ROLE[canteen.role]}{canteen.place ? `, ${canteen.place}` : ""}</span>
                </div>
                <div className="row">
                  <Link className="btn primary" to={`/staff/${canteen._id}/kitchen`}>Kitchen board</Link>
                  {canteen.role !== "kitchen" && <Link className="btn" to={`/staff/${canteen._id}`}>Manage</Link>}
                </div>
              </li>
            ))}
          </ul>
        )}

        <form className="panel stack" onSubmit={create}>
          <h2>Add a canteen</h2>
          <div className="field">
            <label htmlFor="cname">Name</label>
            <input id="cname" value={form.name} maxLength={60} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Block C Canteen" required />
          </div>
          <div className="field">
            <label htmlFor="cplace">Where students find it</label>
            <input id="cplace" value={form.place} maxLength={80} onChange={(e) => setForm((f) => ({ ...f, place: e.target.value }))} placeholder="Ground floor, next to the library" />
          </div>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <div className="row"><button type="submit" className="btn primary" disabled={busy || !form.name.trim()}>{busy ? "Adding…" : "Add canteen"}</button></div>
        </form>
      </main>
    </>
  );
}
