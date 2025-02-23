import express from "express";
import { errorResponse } from "../libs/errorResponse.js";
import userRoutes from "./userRoutes.js";
import authRoutes from "./authRoutes.js";
import bookRoutes from "./bookRoutes.js";
import categoryRoutes from "./categoryRoutes.js";
import profileRoutes from "./profileRoutes.js";
import paymentRoutes from "./paymentRoutes.js";
import aiRoutes from "./aiRoutes.js";
import voiceRoutes from "./voiceRoutes.js";
const router = express.Router();

router.use("/auth", authRoutes);
router.use("/user", userRoutes);
router.use("/book", bookRoutes);
router.use("/category", categoryRoutes);
router.use("/profile", profileRoutes)
router.use("/payment", paymentRoutes)
router.use("/ai", aiRoutes)
router.use("/voices", voiceRoutes)

router.use("*", (req, res) => {
    errorResponse(res, "Route not found", 404);
});

export default router;
