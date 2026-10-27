import { Router } from "express";
import { protect, optionalUser } from "../middlewares/auth.middleware.js";
import { canteenAccess } from "../middlewares/canteen.middleware.js";
import { listCanteens, myCanteens, createCanteen, getMenu, getCanteen, updateCanteen, setAccepting } from "../controllers/canteen.controller.js";
import { listItems, createItem, updateItem, markSoldOut, restock } from "../controllers/item.controller.js";
import { createOrder, board } from "../controllers/order.controller.js";
import { getPlan, savePlan } from "../controllers/plan.controller.js";
import { getReport } from "../controllers/report.controller.js";
import { listMembers, inviteMember, cancelInvite, changeRole, removeMember } from "../controllers/team.controller.js";

const router = Router();

// Students: browse without an account, sign in to order.
router.get("/", listCanteens);
router.get("/menu/:slug", optionalUser, getMenu);
router.post("/:canteenId/orders", protect, createOrder);

// Staff. kitchen < manager < owner; each route names the lowest role that may use it.
router.get("/mine", protect, myCanteens);
router.post("/", protect, createCanteen);
router.get("/:canteenId", protect, canteenAccess("kitchen"), getCanteen);
router.patch("/:canteenId", protect, canteenAccess("manager"), updateCanteen);
router.post("/:canteenId/accepting", protect, canteenAccess("kitchen"), setAccepting);
router.get("/:canteenId/board", protect, canteenAccess("kitchen"), board);
router.get("/:canteenId/items", protect, canteenAccess("kitchen"), listItems);
router.post("/:canteenId/items", protect, canteenAccess("manager"), createItem);
router.patch("/:canteenId/items/:itemId", protect, canteenAccess("manager"), updateItem);
router.post("/:canteenId/items/:itemId/sold-out", protect, canteenAccess("kitchen"), markSoldOut);
router.post("/:canteenId/items/:itemId/restock", protect, canteenAccess("kitchen"), restock);
router.get("/:canteenId/plan", protect, canteenAccess("manager"), getPlan);
router.put("/:canteenId/plan", protect, canteenAccess("manager"), savePlan);
router.get("/:canteenId/report", protect, canteenAccess("manager"), getReport);
router.get("/:canteenId/members", protect, canteenAccess("kitchen"), listMembers);
router.patch("/:canteenId/members/:userId", protect, canteenAccess("manager"), changeRole);
router.delete("/:canteenId/members/:userId", protect, canteenAccess("kitchen"), removeMember);
router.post("/:canteenId/invites", protect, canteenAccess("manager"), inviteMember);
router.delete("/:canteenId/invites/:inviteId", protect, canteenAccess("manager"), cancelInvite);

export default router;
