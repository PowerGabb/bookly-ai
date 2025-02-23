import express from "express";
import { syncVoices, getVoices } from "../controllers/voiceController.js";
import { isAuth } from "../middleware/isAuth.js";

const voiceRoutes = express.Router();

voiceRoutes.post("/sync", isAuth, syncVoices);
voiceRoutes.get("/", isAuth, getVoices);

export default voiceRoutes; 