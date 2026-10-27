import mongoose from "mongoose";
import Canteen from "../models/canteen.model.js";

const RANK = { kitchen: 1, manager: 2, owner: 3 };

export const roleOf = (canteen, userId) => {
  if (!userId) return null;
  if (canteen.owner.equals(userId)) return "owner";
  return canteen.members.find((member) => member.user.equals(userId))?.role ?? null;
};

export const atLeast = (role, minRole) => Boolean(role) && RANK[role] >= RANK[minRole];

// Loads req.canteen for staff routes and checks the caller's role. A canteen you don't
// work at is a 404, not a 403, so its admin pages can't be probed.
export const canteenAccess = (minRole = "kitchen") => async (req, res, next) => {
  const canteen = mongoose.isValidObjectId(req.params.canteenId) ? await Canteen.findById(req.params.canteenId) : null;
  const role = canteen && roleOf(canteen, req.user._id);

  if (!role) {
    return res.status(404).json({ message: "Canteen not found" });
  }

  if (!atLeast(role, minRole)) {
    return res.status(403).json({ message: minRole === "owner" ? "Only the owner can do that" : "Only the owner or a manager can do that" });
  }

  req.canteen = canteen;
  req.role = role;
  next();
};
