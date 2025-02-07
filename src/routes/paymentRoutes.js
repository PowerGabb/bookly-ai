import express from "express";
import { createPayment, handleCallback } from "../controllers/paymentController.js";
import { isAuth } from "../middleware/isAuth.js";

const paymentRoutes = express.Router();

paymentRoutes.post("/create", isAuth, createPayment);
paymentRoutes.post("/callback", handleCallback);

export default paymentRoutes;