import { Link } from "react-router-dom";

// A painted shop sign: yellow letters on board green.
export default function Logo({ to = "/", small = false }) {
  return (
    <Link to={to} className={`logo${small ? " small" : ""}`} aria-label="Agla home">
      <span>agla!</span>
    </Link>
  );
}
