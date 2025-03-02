import express from "express";
import { errorResponse } from "../libs/errorResponse.js";
import userRoutes from "./userRoutes.js";
import authRoutes from "./authRoutes.js";
import bookRoutes from "./bookRoutes.js";
import categoryRoutes from "./categoryRoutes.js";
import profileRoutes from "./profileRoutes.js";
import paymentRoutes from "./paymentRoutes.js";
import aiRoutes from "./aiRoutes.js";
import eventRoutes from "./eventRoutes.js";
import creditsTopupRoutes from "./creditsTopup.js";
import creditPackageRoutes from "./creditPackageRoutes.js";
import customerSupportRoutes from "./customerSupportRoutes.js";
import referralRoutes from "./referralRoutes.js";

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/user", userRoutes);
router.use("/book", bookRoutes);
router.use("/category", categoryRoutes);
router.use("/profile", profileRoutes)
router.use("/payment", paymentRoutes)
router.use("/ai", aiRoutes)
router.use("/events", eventRoutes)
router.use("/credits-topup", creditsTopupRoutes)
router.use("/credit-packages", creditPackageRoutes)
router.use("/customer-support", customerSupportRoutes)
router.use("/referral", referralRoutes)

router.use("*", (req, res) => {
    errorResponse(res, "Route not found", 404);
});

export default router;
