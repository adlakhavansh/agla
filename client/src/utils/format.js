const rupeeFormat = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Paise to "₹45" or "₹45.50".
export const rupees = (paise) => rupeeFormat.format((paise ?? 0) / 100);

// 750 → "12:30 pm"
export const clock = (minute) => {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

export const timeOf = (date) =>
  new Date(date).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export const dayLabel = (day, options = { weekday: "long", day: "numeric", month: "short" }) =>
  new Date(`${day}T00:00:00+05:30`).toLocaleDateString("en-IN", { ...options, timeZone: "Asia/Kolkata" });

// IST calendar day, matching the server.
export const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const firstName = (name) => String(name ?? "").split(" ")[0];
