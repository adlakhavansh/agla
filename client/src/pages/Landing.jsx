import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import Logo from "../components/Logo";
import Segments from "../components/Segments";
import DotMatrix from "../components/DotMatrix";
import { api } from "../services/api";
import { rupees } from "../utils/format";

const FALLBACK_SIGN = "ORDER AHEAD  ◆  PICK A SLOT  ◆  WALK UP WHEN YOUR TOKEN IS CALLED  ◆  AGLA!";

// The shop sign reads today's real menu: what's on, what it costs, what's running out.
function useShopSign() {
  const [text, setText] = useState(FALLBACK_SIGN);
  useEffect(() => {
    let alive = true;
    api.get("/api/canteens")
      .then(({ canteens }) => {
        const canteen = canteens.find((c) => c.openNow) ?? canteens[0];
        return canteen ? api.get(`/api/canteens/menu/${canteen.slug}`) : null;
      })
      .then((menu) => {
        if (!alive || !menu?.items.length) return;
        const items = menu.items.slice(0, 14).map((item) => {
          const note = item.left === 0 ? "  SOLD OUT" : item.left !== null && item.left <= 10 ? `  ONLY ${item.left} LEFT` : "";
          return `${item.name.toUpperCase()} ${rupees(item.price)}${note}`;
        });
        setText([menu.canteen.name.toUpperCase(), ...items].join("  ◆  "));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return text;
}

// The counter's board calling the next number, with the shout that goes with it.
function CallingBoard() {
  const [token, setToken] = useState(41);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    let off;
    const timer = setInterval(() => {
      setToken((t) => (t >= 99 ? 1 : t + 1));
      setFlash(true);
      off = setTimeout(() => setFlash(false), 1100);
    }, 3400);
    return () => {
      clearInterval(timer);
      clearTimeout(off);
    };
  }, []);

  return (
    <div className="calling" aria-hidden="true">
      <div className="calling-housing">
        <span className="calling-label">Now serving</span>
        <Segments value={token} digits={3} height={112} className={flash ? "blink" : ""} />
      </div>
      <p className={`calling-shout${flash ? " show" : ""}`}>Agla!</p>
    </div>
  );
}

const STORY = [
  {
    status: "placed",
    title: "Order between classes",
    text: "Pick what you want and a 15-minute slot. Every slot shows how full it is, and every dish shows how many plates are left, down to the last samosa.",
    headline: "Your order is in",
  },
  {
    status: "preparing",
    title: "The kitchen cooks for your slot",
    text: "Your order lands on the kitchen board with everything due in the next half hour added up, so it's made for 1:15, not kept warm since noon.",
    headline: "It's on the stove",
  },
  {
    status: "ready",
    title: "Your number comes up",
    text: "Your phone dings and the token lights up. Walk past the queue, say your four digits at the counter, and it's yours. Nobody else can claim it.",
    headline: "Ready. Walk up to the counter.",
  },
];

// One order, followed from phone to counter. The ticket stays pinned while the steps scroll past.
function Story() {
  const [step, setStep] = useState(0);
  const refs = useRef([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setStep(Number(entry.target.dataset.step));
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    refs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const current = STORY[step];
  return (
    <section className="story" aria-labelledby="story-title">
      <h2 id="story-title" className="story-title">One order, from your seat to the counter</h2>
      <div className="story-grid">
        <div className="story-pin">
          <div className={`story-ticket at-${current.status}`} aria-hidden="true">
            <div className="token-housing small">
              <span className="token-label">Token</span>
              <Segments value={42} digits={3} height={64} className={current.status === "ready" ? "blink" : ""} label="" />
            </div>
            <p className="story-headline">{current.headline}</p>
            <p className="story-pickup">Pickup at <strong>1:15 pm</strong></p>
            <p className="code">{["4", "7", "1", "2"].map((d, i) => <span key={i}>{d}</span>)}</p>
            <ol className="progress">
              {["Order in", "Cooking", "Ready"].map((label, i) => (
                <li key={label} className={i < step ? "done" : i === step ? "now" : ""}><span className="progress-label">{label}</span></li>
              ))}
            </ol>
          </div>
        </div>
        <ol className="story-steps">
          {STORY.map((item, i) => (
            <li key={item.status} ref={(el) => (refs.current[i] = el)} data-step={i} className={i === step ? "active" : ""}>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// Food thrown away in the demo canteen's last four weeks, one dot for every five plates.
const WASTE = [
  { label: "Making the same amount every day", plates: 1025, cost: "₹18,338" },
  { label: "Following Agla's prep plan", plates: 742, cost: "₹13,598" },
];

function Proof() {
  return (
    <section className="proof" aria-labelledby="proof-title">
      <div className="proof-copy">
        <h2 id="proof-title">Fewer samosas in the bin</h2>
        <p>
          The prep plan reads the last eight Tuesdays before it tells the kitchen how much to make for this one. It counts the
          days a dish sold out at 12:40 as days people wanted more, and weighs a wasted plate against a missed sale.
        </p>
        <p className="proof-note">Replayed on the demo canteen's last four weeks of orders. The orders are generated; the maths is the real thing.</p>
      </div>
      <div className="plates">
        {WASTE.map((row) => (
          <figure key={row.label} className="plate-row">
            <figcaption><span>{row.label}</span><strong>{row.plates.toLocaleString("en-IN")} plates, {row.cost}</strong></figcaption>
            <div className="plate-dots" role="img" aria-label={`${row.plates} plates thrown away`}>
              {Array.from({ length: Math.round(row.plates / 5) }, (_, i) => <i key={i} />)}
            </div>
          </figure>
        ))}
        <p className="proof-note">Each dot is five plates thrown away at closing.</p>
      </div>
    </section>
  );
}

export default function Landing() {
  const user = useSelector((state) => state.auth.user);
  const sign = useShopSign();

  return (
    <div className="landing">
      <DotMatrix text={sign} className="shop-sign" label={`Today's menu: ${sign}`} />

      <section className="hero">
        <header className="landing-bar">
          <Logo />
          <nav>
            <Link to="/canteens">Canteens</Link>
            {user ? <Link to="/orders">My orders</Link> : <Link to="/login">Log in</Link>}
          </nav>
        </header>
        <div className="hero-inner">
          <div className="hero-copy">
            <h1>Order before class ends. Eat when it does.</h1>
            <p>Agla is pre-ordering for your campus canteen. Choose a pickup time, pay by UPI or at the counter, and walk up when your token comes on the board.</p>
            <div className="row">
              <Link className="btn turmeric big" to="/canteens">See today's menu</Link>
              <Link className="btn on-green big" to="/staff">Run a canteen</Link>
            </div>
          </div>
          <figure className="hero-figure">
            <img src="/img/samosa-chai.jpg" alt="Two samosas in a paper-lined basket beside a glass of cutting chai" width="1400" height="934" />
            <CallingBoard />
          </figure>
        </div>
      </section>

      <Story />
      <Proof />

      <section className="for-canteens">
        <div>
          <h2>For the people behind the counter</h2>
          <p className="soft">Built around how a busy campus kitchen actually runs.</p>
        </div>
        <dl>
          <dt>A board the whole kitchen can read</dt>
          <dd>New, cooking, ready, in letters big enough for across the room. One tap moves an order, and two people tapping at once can't double it.</dd>
          <dt>No-shows have a cost</dt>
          <dd>Miss two pickups in a month and paying at the counter turns off until you've been reliable again.</dd>
          <dt>Payments that fix themselves</dt>
          <dd>UPI or card through Razorpay. Cancelled orders refund on their own, and a refund that fails keeps retrying.</dd>
          <dt>Running out, said out loud</dt>
          <dd>Mark a dish sold out and every open menu updates the same second. Add a fresh batch and it's back.</dd>
        </dl>
      </section>

      <section className="shout-band">
        <p className="shout-word" aria-hidden="true">Agla!</p>
        <div>
          <h2>Your turn, without the queue</h2>
          <Link className="btn primary big" to="/canteens">Order from your canteen</Link>
        </div>
      </section>

      <footer className="landing-foot">
        <Logo small />
        <p className="soft small">Campus canteen pre-ordering. Photo by Prajakta Bagade on Unsplash.</p>
      </footer>
    </div>
  );
}
