import mongoose from "mongoose";
import { createHash, randomBytes } from "node:crypto";
import Canteen from "../models/canteen.model.js";
import Invite from "../models/invite.model.js";
import { publicCanteen } from "../utils/views.js";
import { roleOf, atLeast } from "../middlewares/canteen.middleware.js";
import { resetKitchen } from "../socket.js";

const ROLES = ["manager", "kitchen"];
const INVITE_FIELDS = "role label expiresAt createdAt";
const INVALID_INVITE = "This invite link is invalid, expired or already used";
// Only a hash of the link is stored, so a database leak doesn't hand out staff access.
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

const pendingInvite = (token, userId) => /^[A-Za-z0-9_-]{32}$/.test(token) ? {
  tokenHash: hashToken(token),
  status: "pending",
  expiresAt: { $gt: new Date() },
  $or: [{ acceptedBy: { $exists: false } }, { acceptedBy: userId }],
} : null;

export const listMembers = async (req, res) => {
  const canteen = await req.canteen.populate([
    { path: "owner", select: "name email" },
    { path: "members.user", select: "name email" },
  ]);

  const people = [
    { user: canteen.owner, role: "owner" },
    ...canteen.members.filter((member) => member.user).map((member) => ({ user: member.user, role: member.role })),
  ];

  // Only people who can manage the team see who's been invited.
  const invites = atLeast(req.role, "manager")
    ? await Invite.find({ canteen: canteen._id, status: "pending", expiresAt: { $gt: new Date() } }).select(INVITE_FIELDS)
    : [];

  res.json({ members: people, invites });
};

export const inviteMember = async (req, res) => {
  const { role, label } = req.body ?? {};

  if (!ROLES.includes(role)) {
    return res.status(400).json({ message: "Role must be manager or kitchen" });
  }
  if (label !== undefined && (typeof label !== "string" || label.trim().length > 80)) {
    return res.status(400).json({ message: "Label must be 80 characters or fewer" });
  }

  const token = randomBytes(24).toString("base64url");
  const invite = await Invite.create({
    canteen: req.canteen._id,
    role,
    label: label?.trim(),
    invitedBy: req.user._id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  res.status(201).json({ invite: { _id: invite._id, role, label: invite.label, expiresAt: invite.expiresAt, createdAt: invite.createdAt }, token });
};

export const cancelInvite = async (req, res) => {
  const deleted = mongoose.isValidObjectId(req.params.inviteId)
    ? await Invite.findOneAndDelete({ _id: req.params.inviteId, canteen: req.canteen._id, status: "pending" })
    : null;
  if (!deleted) return res.status(404).json({ message: "Invite not found" });
  res.json({ message: "Invite cancelled" });
};

export const changeRole = async (req, res) => {
  const { role } = req.body ?? {};
  if (!ROLES.includes(role)) {
    return res.status(400).json({ message: "Role must be manager or kitchen" });
  }

  // Targeted update, so it can't overwrite someone who joined in the meantime.
  const result = mongoose.isValidObjectId(req.params.userId)
    ? await Canteen.updateOne({ _id: req.canteen._id, "members.user": req.params.userId }, { $set: { "members.$.role": role } })
    : { matchedCount: 0 };
  if (result.matchedCount === 0) return res.status(404).json({ message: "That person isn't on this canteen's team" });
  resetKitchen(req.canteen._id);
  res.json({ message: `Role changed to ${role}` });
};

// Managers can remove anyone but the owner; anyone can remove themselves (leave).
export const removeMember = async (req, res) => {
  const { userId } = req.params;
  const leaving = req.user._id.equals(userId);

  if (req.canteen.owner.equals(userId)) {
    return res.status(400).json({ message: "The owner can't be removed" });
  }
  if (!leaving && !atLeast(req.role, "manager")) {
    return res.status(403).json({ message: "Only the owner or a manager can do that" });
  }

  const result = mongoose.isValidObjectId(userId)
    ? await Canteen.updateOne({ _id: req.canteen._id }, { $pull: { members: { user: userId } } })
    : { modifiedCount: 0 };
  if (result.modifiedCount === 0) {
    return res.status(404).json({ message: "That person isn't on this canteen's team" });
  }

  resetKitchen(req.canteen._id);
  res.json({ message: leaving ? "You left the team" : "Removed from the team" });
};

export const previewInvite = async (req, res) => {
  const filter = pendingInvite(req.params.token, req.user._id);
  if (!filter) return res.status(404).json({ message: INVALID_INVITE });

  const invite = await Invite.findOne(filter)
    .populate("canteen", "name slug place owner members")
    .populate("invitedBy", "name");
  if (!invite?.canteen) return res.status(404).json({ message: INVALID_INVITE });

  const canteen = invite.canteen;
  res.json({ invite: {
    canteen: { _id: canteen._id, name: canteen.name, place: canteen.place },
    role: invite.role,
    invitedBy: { name: invite.invitedBy?.name ?? "Someone" },
    expiresAt: invite.expiresAt,
    alreadyMember: Boolean(roleOf(canteen, req.user._id)),
  } });
};

export const acceptInvite = async (req, res) => {
  const me = req.user._id;
  const filter = pendingInvite(req.params.token, me);
  if (!filter) return res.status(404).json({ message: INVALID_INVITE });

  // Reserve the link for this account so two people can't join with it at once.
  // Keeping it pending lets this person retry if adding access is interrupted.
  const invite = await Invite.findOneAndUpdate(filter, { acceptedBy: me }, { returnDocument: "after" });
  if (!invite) return res.status(404).json({ message: INVALID_INVITE });

  const joined = await Canteen.findOneAndUpdate(
    { _id: invite.canteen, owner: { $ne: me }, "members.user": { $ne: me } },
    { $push: { members: { user: me, role: invite.role } } },
    { returnDocument: "after" }
  );
  const canteen = joined ?? await Canteen.findById(invite.canteen);
  if (!canteen) return res.status(404).json({ message: INVALID_INVITE });

  // Add access before using up the link, so a retry can finish an interrupted accept.
  const accepted = await Invite.updateOne({ _id: invite._id, status: "pending", acceptedBy: me }, { status: "accepted", acceptedBy: me });
  if (accepted.modifiedCount === 0) return res.status(404).json({ message: INVALID_INVITE });

  res.json({
    message: joined ? `You joined ${canteen.name}` : "You're already on this team",
    canteen: { ...publicCanteen(canteen), role: roleOf(canteen, me) },
  });
};

export const declineInvite = async (req, res) => {
  const filter = pendingInvite(req.params.token, req.user._id);
  if (!filter) return res.status(404).json({ message: INVALID_INVITE });

  const declined = await Invite.findOneAndUpdate({ ...filter, acceptedBy: { $exists: false } }, { status: "declined" });
  if (!declined) return res.status(404).json({ message: INVALID_INVITE });
  res.json({ message: "Invite declined" });
};
