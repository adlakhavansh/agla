import { useState } from "react";
import { useDispatch } from "react-redux";
import { Link, useNavigate, useParams } from "react-router-dom";
import Header from "../components/Header";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import { addToast } from "../store/toastSlice";

const ROLE = { manager: "a manager", kitchen: "kitchen staff" };

function InviteLink({ token }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const base = `/api/invites/${encodeURIComponent(token)}`;
  const { data, error, loading } = useApi(base);
  const [busy, setBusy] = useState(null);
  const [answerError, setAnswerError] = useState(null);
  const invite = data?.invite;
  const failure = error ?? answerError;

  const answer = async (choice) => {
    if (busy !== null) return;
    setBusy(choice);
    setAnswerError(null);
    try {
      const result = await api.post(`${base}/${choice}`);
      dispatch(addToast(result.message));
      navigate(choice === "accept" ? (result.canteen.role === "kitchen" ? `/staff/${result.canteen._id}/kitchen` : `/staff/${result.canteen._id}`) : "/staff");
    } catch (err) {
      setAnswerError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="page narrow">
      <h1 className="page-title">Staff invite</h1>
      {loading ? (
        <p className="soft" role="status">Checking the invite…</p>
      ) : failure && (!invite || failure.status === 404) ? (
        <div className="notice error" role="alert"><p>{failure.message}</p><Link className="btn small" to="/staff">Staff side</Link></div>
      ) : invite ? (
        <section className="panel stack">
          <p><strong>{invite.invitedBy.name}</strong> invited you to join <strong>{invite.canteen.name}</strong> as {ROLE[invite.role]}.</p>
          <p className="soft small">The link works once and expires on {new Date(invite.expiresAt).toLocaleDateString("en-IN")}.</p>
          {failure && <p className="form-error" role="alert">{failure.message}</p>}
          {invite.alreadyMember ? (
            <div className="row"><Link className="btn primary" to={`/staff/${invite.canteen._id}`}>You're already on the team. Open it</Link></div>
          ) : (
            <div className="row">
              <button type="button" className="btn primary" disabled={busy !== null} onClick={() => answer("accept")}>{busy === "accept" ? "Joining…" : "Join the team"}</button>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => answer("decline")}>{busy === "decline" ? "Declining…" : "Decline"}</button>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}

export default function Invite() {
  const { token } = useParams();
  return <><Header /><InviteLink key={token} token={token} /></>;
}
