import express from "express";
import { createPayment, handleCallback, getStatus } from "../controllers/paymentController.js";
import { isAuth } from "../middleware/isAuth.js";

const paymentRoutes = express.Router();

paymentRoutes.post("/create", isAuth, createPayment);
paymentRoutes.post("/callback", handleCallback);
paymentRoutes.get("/status/:orderId", isAuth, getStatus);

export default paymentRoutes;