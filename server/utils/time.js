// ponytail: every canteen runs on IST (a fixed +5:30, no daylight saving); add a timezone per canteen if Agla leaves India.
const IST_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// "2026-10-27" for the IST calendar day a moment falls on.
export const dayOf = (date = new Date()) => new Date(date.getTime() + IST_MS).toISOString().slice(0, 10);

// Minutes since IST midnight, so 12:30 is 750.
export const minuteOf = (date = new Date()) => {
  const ist = new Date(date.getTime() + IST_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
};

// The moment a day + minute pair stands for.
export const dateAt = (day, minute) => new Date(Date.parse(`${day}T00:00:00Z`) - IST_MS + minute * 60_000);

export const weekdayOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();

export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

export const clock = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
