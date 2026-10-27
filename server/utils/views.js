import { clock } from "./time.js";

// What the student sees: everything, including the pickup code.
export const forStudent = (order) => ({
  _id: order._id,
  canteen: order.canteen,
  token: order.token,
  day: order.day,
  slot: order.slot,
  slotLabel: clock(order.slot),
  pickupAt: order.pickupAt,
  lines: order.lines,
  total: order.total,
  status: order.status,
  code: order.code,
  payment: { method: order.payment.method, status: order.payment.status },
  cancelledBy: order.cancelledBy,
  cancelReason: order.cancelReason,
  times: order.times,
  createdAt: order.createdAt,
});

// What the kitchen sees: the same order without the code, so only the student can claim it.
export const forKitchen = (order) => {
  const { code, ...rest } = forStudent(order);
  return { ...rest, customer: order.customer };
};

export const publicCanteen = (canteen) => ({
  _id: canteen._id,
  name: canteen.name,
  slug: canteen.slug,
  place: canteen.place,
  opensAt: canteen.opensAt,
  closesAt: canteen.closesAt,
  slotMinutes: canteen.slotMinutes,
  slotCapacity: canteen.slotCapacity,
  leadMinutes: canteen.leadMinutes,
  openDays: canteen.openDays,
  acceptingOrders: canteen.acceptingOrders,
});

export const publicItem = (item) => ({
  _id: item._id,
  name: item.name,
  description: item.description,
  category: item.category,
  price: item.price,
  veg: item.veg,
  batch: item.dailyLimit !== null,
});
