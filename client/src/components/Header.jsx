import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, NavLink, useNavigate } from "react-router-dom";
import Logo from "./Logo";
import { logout } from "../store/authSlice";

// The student-side top bar.
export default function Header() {
  const user = useSelector((state) => state.auth.user);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menu = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : !menu.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <header className="topbar">
      <Logo to="/canteens" />
      <nav className="topnav">
        <NavLink to="/canteens" end>Canteens</NavLink>
        {user && <NavLink to="/orders">My orders</NavLink>}
        {user ? (
          <div className="account" ref={menu}>
            <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {user.name.slice(0, 1).toUpperCase()}
            </button>
            {open && (
              <div className="popover" role="menu">
                <p className="who"><strong>{user.name}</strong><span>{user.email}</span></p>
                <Link role="menuitem" to="/staff" onClick={() => setOpen(false)}>Staff side</Link>
                <button role="menuitem" type="button" onClick={() => dispatch(logout()).then(() => navigate("/"))}>Log out</button>
              </div>
            )}
          </div>
        ) : (
          <Link className="btn small" to="/login">Log in</Link>
        )}
      </nav>
    </header>
  );
}
