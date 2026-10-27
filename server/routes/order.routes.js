import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { myOrders, getOrder, verifyPayment, cancelMine, kitchenMove, collectOrder } from "../controllers/order.controller.js";

const router = Router();

router.use(protect);
router.get("/", myOrders);
router.get("/:orderId", getOrder);
// Student
router.post("/:orderId/pay", verifyPayment);
router.post("/:orderId/cancel", cancelMine);
// Kitchen (checked inside: the caller must work at the order's canteen)
router.post("/:orderId/status", kitchenMove);
router.post("/:orderId/collect", collectOrder);

export default router;
