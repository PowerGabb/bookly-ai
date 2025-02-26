import express from "express";
import { createTopup, handleCallback, getStatus, getPackages } from "../controllers/creditsTopupController.js";
import { isAuth } from "../middleware/isAuth.js";

const creditsTopupRoutes = express.Router();

creditsTopupRoutes.get("/packages", isAuth, getPackages);
creditsTopupRoutes.post("/create", isAuth, createTopup);
creditsTopupRoutes.post("/callback", handleCallback);
creditsTopupRoutes.get("/status/:token", isAuth, getStatus);

export default creditsTopupRoutes;
