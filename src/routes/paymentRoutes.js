import express from "express";
import { createPayment, handleCallback, getStatus, getPendingTransaction } from "../controllers/paymentController.js";
import { isAuth } from "../middleware/isAuth.js";

const paymentRoutes = express.Router();

// Middleware khusus untuk Stripe webhook
const stripeWebhookMiddleware = express.raw({ type: 'application/json' });

paymentRoutes.post("/create", isAuth, createPayment);
paymentRoutes.post("/webhook", stripeWebhookMiddleware, handleCallback);
paymentRoutes.get("/status/:sessionId", isAuth, getStatus);
paymentRoutes.get("/pending", isAuth, getPendingTransaction);

export default paymentRoutes;