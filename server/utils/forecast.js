// The prep plan's maths. Pure functions, so forecast.check.js can test them without a database.

// Recent weeks count more: last week weighs 1, the week before 0.85, then 0.72 and so on.
export const RECENCY = 0.85;
// Below this many weeks of the same weekday, there's no suggestion, just "not enough history".
export const MIN_WEEKS = 3;
// When a manager hasn't said what a plate costs to make, assume 40% of its price.
export const DEFAULT_COST_SHARE = 0.4;

// Demand is what people wanted, not what sold. A day that sold out at 12:40 sold everything it
// had; if on normal days 55% of this item's sales are in by 12:40, the whole day would have
// sold about sold / 0.55. Capped at 3x so one very early sell-out can't run away with the plan.
export const demandOf = ({ sold, soldOut, shareBeforeSoldOut }) => {
  if (!soldOut || !shareBeforeSoldOut) return sold;
  return Math.round(sold / Math.max(shareBeforeSoldOut, 1 / 3));
};

// The smallest value whose weight, counting up from the bottom, reaches q of the total.
export const weightedQuantile = (points, q) => {
  const sorted = [...points].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, point) => sum + point.weight, 0);
  let seen = 0;
  for (const point of sorted) {
    seen += point.weight;
    if (seen >= q * total - 1e-9) return point.value;
  }
  return sorted.at(-1).value;
};

// Make one plate too few and you lose its margin (price - cost); one too many and you throw
// away what it cost. The quantity that balances the two covers demand this share of the
// time (the "newsvendor" critical ratio), kept between 50% and 95%.
export const serviceLevel = (price, cost) => Math.min(0.95, Math.max(0.5, (price - cost) / price));

// history: the same weekday in past weeks, [{ sold, soldOut, shareBeforeSoldOut, weeksAgo }].
export const planItem = ({ price, cost, history }) => {
  const unitCost = cost ?? Math.round(price * DEFAULT_COST_SHARE);
  const level = serviceLevel(price, unitCost);
  if (history.length < MIN_WEEKS) {
    return { level, suggestion: null, expected: null, sellOutChance: null, leftover: null, leftoverCost: null };
  }

  const points = history.map((day) => ({ value: demandOf(day), weight: RECENCY ** (day.weeksAgo - 1) }));
  const totalWeight = points.reduce((sum, point) => sum + point.weight, 0);
  const average = (fn) => points.reduce((sum, point) => sum + fn(point.value) * point.weight, 0) / totalWeight;

  const suggestion = Math.ceil(weightedQuantile(points, level));
  const leftover = average((demand) => Math.max(0, suggestion - demand));
  return {
    level,
    suggestion,
    // The typical day (weighted median), so it never sits above the suggestion.
    expected: Math.round(weightedQuantile(points, 0.5)),
    // On a day like the ones in history: how often this would still sell out, and what's left over.
    sellOutChance: average((demand) => (demand > suggestion ? 1 : 0)),
    leftover: Math.round(leftover),
    leftoverCost: Math.round(leftover * unitCost),
  };
};
