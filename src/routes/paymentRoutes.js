import express from "express";
import { createPayment, handleCallback, getStatus, getPendingTransaction, getSubscriptionPlans, checkAndResetExpiredSubscriptions } from "../controllers/paymentController.js";
import { isAuth } from "../middleware/isAuth.js";

const paymentRoutes = express.Router();

paymentRoutes.get("/plans", getSubscriptionPlans);
paymentRoutes.post("/create", isAuth, createPayment);
paymentRoutes.post("/webhook", handleCallback);
paymentRoutes.get("/status/:sessionId", isAuth, getStatus);
paymentRoutes.get("/pending", isAuth, getPendingTransaction);
paymentRoutes.post("/check-expired", checkAndResetExpiredSubscriptions);

export default paymentRoutes;