import express from "express";
import { createPayment, handleCallback, getStatus, getPendingTransaction } from "../controllers/paymentController.js";
import { isAuth } from "../middleware/isAuth.js";

const paymentRoutes = express.Router();

paymentRoutes.post("/create", isAuth, createPayment);
paymentRoutes.post("/callback", handleCallback);
paymentRoutes.get("/status/:token", isAuth, getStatus);
paymentRoutes.get("/pending", isAuth, getPendingTransaction);

export default paymentRoutes;