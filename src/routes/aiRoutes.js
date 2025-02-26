import express from "express";
import { askPage, getChatHistory, textToSpeech, getPageAudios } from "../controllers/aiController.js";
import { isAuth } from "../middleware/isAuth.js";
import { isHaveCredit } from "../middleware/isHaveToken.js";

const aiRoutes = express.Router();

// Setiap request askPage menggunakan 1 kredit AI_CHAT
aiRoutes.post('/ask-page', isAuth, isHaveCredit('AI_CHAT'), askPage);
aiRoutes.get('/chat-history/:bookId', isAuth, getChatHistory);

// Setiap request text-to-speech menggunakan 1 kredit TTS
aiRoutes.post('/text-to-speech', isAuth, isHaveCredit('TTS'), textToSpeech);
aiRoutes.get('/page-audios/:bookId/:pageNumber', isAuth, getPageAudios);

export default aiRoutes;