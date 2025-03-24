import express from "express";
import { createPayment, handleCallback, getStatus, getPendingTransaction } from "../controllers/paymentController.js";
import { isAuth } from "../middleware/isAuth.js";
import bodyParser from 'body-parser';

const paymentRoutes = express.Router();

// Middleware khusus untuk Stripe webhook
const stripeWebhookMiddleware = express.raw({ 
  type: 'application/json',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
});

paymentRoutes.post("/create", isAuth, createPayment);
paymentRoutes.post("/webhook", bodyParser.raw({type: 'application/json'}), handleCallback);
paymentRoutes.get("/status/:sessionId", isAuth, getStatus);
paymentRoutes.get("/pending", isAuth, getPendingTransaction);

export default paymentRoutes;