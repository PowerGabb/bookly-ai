import express from "express";
import { getReferralCode, getReferralHistory } from "../controllers/referralController.js";
import { isAuth } from "../middleware/isAuth.js";

const referralRoutes = express.Router();

referralRoutes.get("/code", isAuth, getReferralCode);
referralRoutes.get("/history", isAuth, getReferralHistory);

export default referralRoutes;
