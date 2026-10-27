import { useSelector } from "react-redux";
import { Navigate, useLocation } from "react-router-dom";

export default function RequireAuth({ children }) {
  const { user, status } = useSelector((state) => state.auth);
  const location = useLocation();

  if (status === "loading") return <div className="empty-page">Loading…</div>;
  if (status === "offline") {
    return <div className="empty-page">Can't reach Agla right now. The server may be waking up; refresh in a minute.</div>;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}
