import { clock, minuteOf, weekdayOf } from "./time.js";

// Every slot start in a day: 8:00, 8:15 … up to the last one that ends by closing time.
export const slotStarts = (canteen) => {
  const starts = [];
  for (let minute = canteen.opensAt; minute + canteen.slotMinutes <= canteen.closesAt; minute += canteen.slotMinutes) {
    starts.push(minute);
  }
  return starts;
};

export const isOpenOn = (canteen, day) => canteen.openDays.includes(weekdayOf(day));

const bookedIn = (slots, start) => (slots instanceof Map ? slots.get(String(start)) : slots?.[start]) ?? 0;

// Today's slots with how full each one is. A slot is open while it's far enough away
// for the kitchen to cook and still has room.
export const slotBoard = (canteen, dayDoc, now = new Date()) => {
  const earliest = minuteOf(now) + canteen.leadMinutes;
  return slotStarts(canteen).map((start) => {
    const booked = bookedIn(dayDoc?.slots, start);
    return {
      start,
      label: clock(start),
      booked,
      capacity: canteen.slotCapacity,
      open: start >= earliest && booked < canteen.slotCapacity,
    };
  });
};
