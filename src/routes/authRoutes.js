import express from "express";
import { register, activate, login, refreshToken, googleAuth } from "../controllers/authController.js";
const authRoutes = express.Router();

authRoutes.post("/register", register);
authRoutes.post("/activate", activate);
authRoutes.post("/login", login);
authRoutes.post("/refresh-token", refreshToken);
authRoutes.post("/google-auth", googleAuth);

export default authRoutes;