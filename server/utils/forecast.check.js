// node utils/forecast.check.js — fails loudly if the prep plan maths breaks.
import assert from "node:assert/strict";
import { demandOf, weightedQuantile, serviceLevel, planItem } from "./forecast.js";

// A normal day's demand is what sold; a sell-out is scaled up by how early it happened.
assert.equal(demandOf({ sold: 40, soldOut: false }), 40);
assert.equal(demandOf({ sold: 40, soldOut: true, shareBeforeSoldOut: 0.5 }), 80);
assert.equal(demandOf({ sold: 40, soldOut: true, shareBeforeSoldOut: 0.05 }), 120, "capped at 3x");

const even = [10, 20, 30, 40].map((value) => ({ value, weight: 1 }));
assert.equal(weightedQuantile(even, 0.5), 20);
assert.equal(weightedQuantile(even, 0.75), 30);
assert.equal(weightedQuantile(even, 1), 40);
// A heavy recent week pulls the quantile towards it.
assert.equal(weightedQuantile([{ value: 10, weight: 1 }, { value: 50, weight: 3 }], 0.5), 50);

assert.equal(serviceLevel(5000, 2000), 0.6);
assert.equal(serviceLevel(5000, 4900), 0.5, "never below 50%");
assert.equal(serviceLevel(5000, 0), 0.95, "never above 95%");

assert.equal(planItem({ price: 2000, cost: 800, history: [{ sold: 30, weeksAgo: 1 }] }).suggestion, null, "needs 3 weeks");

const steady = [30, 32, 28, 31, 29].map((sold, i) => ({ sold, soldOut: false, weeksAgo: i + 1 }));
const plan = planItem({ price: 2000, cost: 800, history: steady });
assert.ok(plan.suggestion >= 30 && plan.suggestion <= 32, `steady demand plans near it, got ${plan.suggestion}`);
assert.ok(plan.sellOutChance <= 0.4);

// The same sales, but every day sold out at lunch: the plan must go higher.
const censored = steady.map((day) => ({ ...day, soldOut: true, shareBeforeSoldOut: 0.6 }));
assert.ok(planItem({ price: 2000, cost: 800, history: censored }).suggestion > plan.suggestion);

// Cheap to make and pricey to miss → plan for more; expensive leftovers → plan for less.
const spread = [10, 20, 30, 40, 50].map((sold, i) => ({ sold, soldOut: false, weeksAgo: i + 1 }));
assert.ok(planItem({ price: 2000, cost: 200, history: spread }).suggestion > planItem({ price: 2000, cost: 1800, history: spread }).suggestion);

console.log("forecast checks passed");
