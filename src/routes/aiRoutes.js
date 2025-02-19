import express from "express";
import { askPage, getChatHistory } from "../controllers/aiController.js";
import { isAuth } from "../middleware/isAuth.js";

const aiRoutes = express.Router();

aiRoutes.post('/ask-page', isAuth, askPage);
aiRoutes.get('/chat-history/:bookId/:pageNumber', isAuth, getChatHistory);

export default aiRoutes;