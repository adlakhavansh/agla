import { useState } from "react";
import { useDispatch } from "react-redux";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import { addToast } from "../store/toastSlice";
import { useCanteen } from "./StaffLayout";

const ROLE = { owner: "Owner", manager: "Manager", kitchen: "Kitchen" };
const ABOUT = {
  manager: "Menu, hours, prep plan, reports and the team",
  kitchen: "The order board, the counter and stock",
};

export default function Team() {
  const { canteen } = useCanteen();
  const dispatch = useDispatch();
  const { data, error, loading, reload } = useApi(`/api/canteens/${canteen._id}/members`);
  const [role, setRole] = useState("kitchen");
  const [label, setLabel] = useState("");
  const [link, setLink] = useState(null);

  const run = async (fn, message) => {
    try {
      const result = await fn();
      if (message) dispatch(addToast(typeof message === "function" ? message(result) : message));
      reload();
      return result;
    } catch (err) {
      dispatch(addToast(err.message, "error"));
      return null;
    }
  };

  const invite = async (event) => {
    event.preventDefault();
    const result = await run(() => api.post(`/api/canteens/${canteen._id}/invites`, { role, label: label || undefined }));
    if (result) {
      setLink(`${window.location.origin}/invite/${result.token}`);
      setLabel("");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      dispatch(addToast("Link copied"));
    } catch {
      dispatch(addToast("Couldn't copy. Select the link and copy it yourself.", "error"));
    }
  };

  return (
    <>
      <div className="staff-head"><h1>Team</h1></div>
      {loading && !data ? (
        <p className="soft" role="status">Loading…</p>
      ) : error ? (
        <div className="notice error" role="alert"><p>{error.message}</p></div>
      ) : (
        <>
          <table className="table">
            <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.members.map(({ user, role: memberRole }) => (
                <tr key={user._id}>
                  <td><strong>{user.name}</strong><span className="soft small block">{user.email}</span></td>
                  <td>
                    {memberRole === "owner" ? ROLE.owner : (
                      <select aria-label={`Role for ${user.name}`} value={memberRole} onChange={(e) => run(() => api.patch(`/api/canteens/${canteen._id}/members/${user._id}`, { role: e.target.value }), (r) => r.message)}>
                        <option value="manager">Manager</option>
                        <option value="kitchen">Kitchen</option>
                      </select>
                    )}
                  </td>
                  <td className="num">
                    {memberRole !== "owner" && (
                      <button type="button" className="link-btn danger" onClick={() => run(() => api.del(`/api/canteens/${canteen._id}/members/${user._id}`), (r) => r.message)}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form className="panel stack" onSubmit={invite}>
            <h2>Invite someone</h2>
            <fieldset className="segmented">
              <legend>They'll handle</legend>
              {["kitchen", "manager"].map((r) => (
                <label key={r}><input type="radio" checked={role === r} onChange={() => setRole(r)} /> {ROLE[r]}<small>{ABOUT[r]}</small></label>
              ))}
            </fieldset>
            <div className="field narrow-field">
              <label htmlFor="ilabel">Who it's for (just for you)</label>
              <input id="ilabel" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="Raju, evening shift" />
            </div>
            <div className="row"><button type="submit" className="btn primary">Make invite link</button></div>
            {link && (
              <div className="invite-link">
                <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
                <button type="button" className="btn" onClick={copy}>Copy</button>
                <p className="soft small">Works once, for 7 days. Send it on WhatsApp; they open it while logged in.</p>
              </div>
            )}
          </form>

          {data.invites.length > 0 && (
            <section className="stack">
              <h2>Invites not used yet</h2>
              <ul className="plain-list">
                {data.invites.map((inv) => (
                  <li key={inv._id}>
                    <span>{inv.label || "No name"}, {ROLE[inv.role].toLowerCase()}, until {new Date(inv.expiresAt).toLocaleDateString("en-IN")}</span>
                    <button type="button" className="link-btn danger" onClick={() => run(() => api.del(`/api/canteens/${canteen._id}/invites/${inv._id}`), "Invite cancelled")}>Cancel</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
