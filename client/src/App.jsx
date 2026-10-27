import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { Routes, Route } from "react-router-dom";
import { fetchMe } from "./store/authSlice";
import RequireAuth from "./components/RequireAuth";
import Toasts from "./components/Toasts";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Canteens from "./pages/Canteens";
import Menu from "./pages/Menu";
import Ticket from "./pages/Ticket";
import Orders from "./pages/Orders";
import Invite from "./pages/Invite";
import StaffHome from "./pages/StaffHome";
import StaffLayout from "./pages/StaffLayout";
import Kitchen from "./pages/Kitchen";
import MenuEditor from "./pages/MenuEditor";
import PrepPlan from "./pages/PrepPlan";
import Reports from "./pages/Reports";
import Team from "./pages/Team";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

export default function App() {
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(fetchMe());
  }, [dispatch]);

  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Auth mode="login" />} />
        <Route path="/register" element={<Auth mode="register" />} />
        <Route path="/canteens" element={<Canteens />} />
        <Route path="/c/:slug" element={<Menu />} />
        <Route path="/orders" element={<RequireAuth><Orders /></RequireAuth>} />
        <Route path="/orders/:orderId" element={<RequireAuth><Ticket /></RequireAuth>} />
        <Route path="/invite/:token" element={<RequireAuth><Invite /></RequireAuth>} />
        <Route path="/staff" element={<RequireAuth><StaffHome /></RequireAuth>} />
        <Route path="/staff/:canteenId/kitchen" element={<RequireAuth><Kitchen /></RequireAuth>} />
        <Route path="/staff/:canteenId" element={<RequireAuth><StaffLayout /></RequireAuth>}>
          <Route path="report" element={<Reports />} />
          <Route path="plan" element={<PrepPlan />} />
          <Route path="menu" element={<MenuEditor />} />
          <Route path="team" element={<Team />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toasts />
    </>
  );
}
