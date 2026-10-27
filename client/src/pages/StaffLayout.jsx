import { Link, NavLink, Navigate, Outlet, useOutletContext, useParams, useLocation } from "react-router-dom";
import Logo from "../components/Logo";
import { useApi } from "../hooks/useApi";

export const useCanteen = () => useOutletContext();

// The manager's side: a sidebar per canteen. Kitchen staff only get the board.
export default function StaffLayout() {
  const { canteenId } = useParams();
  const location = useLocation();
  const { data, error, loading, reload } = useApi(`/api/canteens/${canteenId}`);

  if (loading && !data) return <p className="empty-page" role="status">Loading…</p>;
  if (error && !data) {
    return (
      <main className="empty-page">
        <h1>{error.status === 404 ? "Canteen not found" : "Couldn't load this canteen"}</h1>
        <p className="soft">{error.message}</p>
        <Link className="btn" to="/staff">Back to staff side</Link>
      </main>
    );
  }

  const { canteen } = data;
  if (canteen.role === "kitchen") return <Navigate to={`/staff/${canteenId}/kitchen`} replace />;
  if (location.pathname.replace(/\/$/, "") === `/staff/${canteenId}`) return <Navigate to="report" replace />;

  return (
    <div className="staff">
      <aside className="sidebar">
        <Logo to="/staff" small />
        <div className="sidebar-canteen">
          <strong>{canteen.name}</strong>
          <Link to={`/c/${canteen.slug}`} className="small">See the student menu</Link>
        </div>
        <nav aria-label="Manage">
          <NavLink to="report">Reports</NavLink>
          <NavLink to="plan">Prep plan</NavLink>
          <NavLink to="menu">Menu</NavLink>
          <NavLink to="team">Team</NavLink>
          <NavLink to="settings">Hours and slots</NavLink>
        </nav>
        <Link className="btn primary block" to={`/staff/${canteenId}/kitchen`}>Open kitchen board</Link>
        <Link className="small soft" to="/staff">All canteens</Link>
      </aside>
      <main className="staff-main">
        <Outlet context={{ canteen, reloadCanteen: reload }} />
      </main>
    </div>
  );
}
