import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <main className="empty-page">
      <h1>Nothing at this counter</h1>
      <p className="soft">That address doesn't match anything in Agla.</p>
      <Link className="btn" to="/canteens">See canteens</Link>
    </main>
  );
}
