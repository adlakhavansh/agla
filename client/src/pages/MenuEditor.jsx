import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import VegMark from "../components/VegMark";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import { addToast } from "../store/toastSlice";
import { rupees } from "../utils/format";
import { useCanteen } from "./StaffLayout";

const toRupees = (paise) => (paise === null || paise === undefined ? "" : String(paise / 100));
const toPaise = (text) => (text.trim() === "" ? null : Math.round(Number(text) * 100));

const EMPTY = { name: "", description: "", category: "", price: "", cost: "", veg: true, batch: false, dailyLimit: "", active: true };

function ItemForm({ item, categories, canteenId, onClose, onSaved }) {
  const dialog = useRef(null);
  const [form, setForm] = useState(() => item ? {
    name: item.name, description: item.description, category: item.category, price: toRupees(item.price), cost: toRupees(item.cost),
    veg: item.veg, batch: item.dailyLimit !== null, dailyLimit: item.dailyLimit ?? "", active: item.active,
  } : EMPTY);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: form.name, description: form.description, category: form.category,
      price: toPaise(form.price), cost: toPaise(form.cost), veg: form.veg,
      dailyLimit: form.batch ? Number.parseInt(form.dailyLimit, 10) || null : null, active: form.active,
    };
    if (form.batch && !body.dailyLimit) {
      setError("Say how many get made each day, or switch to made to order");
      setBusy(false);
      return;
    }
    try {
      const data = item ? await api.patch(`/api/canteens/${canteenId}/items/${item._id}`, body) : await api.post(`/api/canteens/${canteenId}/items`, body);
      onSaved(data.item, item ? "Saved" : `${data.item.name} is on the menu`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="sheet-dialog wide" onClose={onClose} aria-labelledby="item-title">
      <form onSubmit={save} className="stack">
        <h2 id="item-title">{item ? `Edit ${item.name}` : "Add an item"}</h2>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="iname">Name</label>
            <input id="iname" value={form.name} maxLength={60} onChange={set("name")} required />
          </div>
          <div className="field">
            <label htmlFor="icat">Section</label>
            <input id="icat" list="cats" value={form.category} maxLength={30} onChange={set("category")} required placeholder="Snacks" />
            <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
        </div>
        <div className="field">
          <label htmlFor="idesc">Description</label>
          <input id="idesc" value={form.description} maxLength={140} onChange={set("description")} placeholder="What's in it, in a few words" />
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="iprice">Price (₹)</label>
            <input id="iprice" type="number" inputMode="decimal" min="1" step="0.5" value={form.price} onChange={set("price")} required />
          </div>
          <div className="field">
            <label htmlFor="icost">Cost to make one (₹)</label>
            <input id="icost" type="number" inputMode="decimal" min="0" step="0.5" value={form.cost} onChange={set("cost")} placeholder="Optional" />
            <span className="hint">The prep plan uses this to weigh leftovers against selling out.</span>
          </div>
        </div>
        <fieldset className="segmented">
          <legend>How it's made</legend>
          <label><input type="radio" checked={!form.batch} onChange={() => setForm((f) => ({ ...f, batch: false }))} /> Made to order</label>
          <label><input type="radio" checked={form.batch} onChange={() => setForm((f) => ({ ...f, batch: true }))} /> Cooked in a batch</label>
        </fieldset>
        {form.batch && (
          <div className="field narrow-field">
            <label htmlFor="ilimit">Usually made per day</label>
            <input id="ilimit" type="number" min="1" max="2000" value={form.dailyLimit} onChange={set("dailyLimit")} />
            <span className="hint">Students can't order more than this. The prep plan can change it day by day.</span>
          </div>
        )}
        <div className="row">
          <label className="check"><input type="checkbox" checked={form.veg} onChange={set("veg")} /> Vegetarian</label>
          <label className="check"><input type="checkbox" checked={form.active} onChange={set("active")} /> On the menu</label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="row">
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : item ? "Save" : "Add item"}</button>
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>Cancel</button>
        </div>
      </form>
    </dialog>
  );
}

export default function MenuEditor() {
  const { canteen } = useCanteen();
  const dispatch = useDispatch();
  const { data, error, loading, reload } = useApi(`/api/canteens/${canteen._id}/items`);
  const [editing, setEditing] = useState(null);

  const categories = useMemo(() => [...new Set((data?.items ?? []).map((i) => i.category))].sort(), [data]);
  const sections = useMemo(() => {
    const map = new Map();
    for (const item of data?.items ?? []) {
      const key = item.active ? item.category : "Off the menu";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map].sort(([a], [b]) => (a === "Off the menu") - (b === "Off the menu") || a.localeCompare(b));
  }, [data]);

  return (
    <>
      <div className="staff-head">
        <h1>Menu</h1>
        <button type="button" className="btn primary" onClick={() => setEditing("new")}>Add item</button>
      </div>
      {loading && !data ? (
        <p className="soft" role="status">Loading the menu…</p>
      ) : error ? (
        <div className="notice error" role="alert"><p>{error.message}</p><button type="button" className="btn small" onClick={reload}>Try again</button></div>
      ) : data.items.length === 0 ? (
        <div className="empty-block">
          <p>No items yet. Students see the menu exactly as you build it here.</p>
          <button type="button" className="btn primary" onClick={() => setEditing("new")}>Add the first item</button>
        </div>
      ) : (
        sections.map(([section, items]) => (
          <section key={section} className="editor-section">
            <h2>{section}</h2>
            <table className="table">
              <thead>
                <tr><th scope="col">Item</th><th scope="col" className="num">Price</th><th scope="col" className="num">Cost</th><th scope="col">Made</th><th scope="col">Today</th><th scope="col"><span className="sr-only">Edit</span></th></tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const { made, sold } = item.today;
                  return (
                    <tr key={item._id} className={item.active ? "" : "muted-row"}>
                      <td><span className="item-cell"><VegMark veg={item.veg} /> {item.name}</span></td>
                      <td className="num">{rupees(item.price)}</td>
                      <td className="num">{item.cost === null ? "–" : rupees(item.cost)}</td>
                      <td>{item.dailyLimit === null ? "To order" : `${item.dailyLimit} a day`}</td>
                      <td>{made === null ? `${sold} sold` : made - sold <= 0 ? "Sold out" : `${sold} of ${made} sold`}</td>
                      <td className="num"><button type="button" className="link-btn" onClick={() => setEditing(item)}>Edit</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))
      )}
      {editing && (
        <ItemForm
          item={editing === "new" ? null : editing}
          categories={categories}
          canteenId={canteen._id}
          onClose={() => setEditing(null)}
          onSaved={(_, message) => { setEditing(null); dispatch(addToast(message)); reload(); }}
        />
      )}
    </>
  );
}
