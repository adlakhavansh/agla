import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { login, register } from "../store/authSlice";
import Logo from "../components/Logo";

export default function Auth({ mode }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useSelector((state) => state.auth.user);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isLogin = mode === "login";
  const next = location.state?.from ?? "/canteens";

  if (user) return <Navigate to={next} replace />;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const action = isLogin ? login({ email: form.email, password: form.password }) : register(form);
    const result = await dispatch(action);
    setBusy(false);
    if (result.error) setError(result.payload ?? result.error.message);
    else navigate(next, { replace: true });
  };

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const demo = (email) => setForm({ name: "", email, password: "agla-demo" });

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit} noValidate>
        <Logo />
        <div>
          <h1>{isLogin ? "Log in" : "Make an account"}</h1>
          <p className="soft">{isLogin ? "Your cart is saved while you do." : "One account for ordering, and for running a canteen if you do."}</p>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!isLogin && (
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" autoComplete="name" value={form.name} onChange={set("name")} required />
            <span className="hint">The kitchen sees this on your order.</span>
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete={isLogin ? "current-password" : "new-password"} value={form.password} onChange={set("password")} required minLength={8} />
          {!isLogin && <span className="hint">At least 8 characters.</span>}
        </div>
        <button className="btn primary block" type="submit" disabled={busy}>{busy ? "One moment…" : isLogin ? "Log in" : "Make account"}</button>
        <p className="soft small">
          {isLogin ? "New here? " : "Already have an account? "}
          <Link to={isLogin ? "/register" : "/login"} state={location.state}>{isLogin ? "Make an account" : "Log in"}</Link>
        </p>
        {isLogin && (
          <div className="demo-logins">
            <p className="small soft">Trying the demo? Fill in as</p>
            <div className="chips">
              <button type="button" className="chip" onClick={() => demo("student@demo.agla.app")}>Student</button>
              <button type="button" className="chip" onClick={() => demo("kitchen@demo.agla.app")}>Kitchen</button>
              <button type="button" className="chip" onClick={() => demo("owner@demo.agla.app")}>Owner</button>
            </div>
          </div>
        )}
      </form>
    </main>
  );
}
