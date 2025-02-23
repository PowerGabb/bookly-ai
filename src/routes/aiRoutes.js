import express from "express";
import { askPage, getChatHistory, textToSpeech, getPageAudios, getVoicesList } from "../controllers/aiController.js";
import { isAuth } from "../middleware/isAuth.js";

const aiRoutes = express.Router();

aiRoutes.post('/ask-page', isAuth, askPage);
aiRoutes.get('/chat-history/:bookId', isAuth, getChatHistory);
aiRoutes.post('/text-to-speech', isAuth, textToSpeech);
aiRoutes.get('/page-audios/:bookId/:pageNumber', isAuth, getPageAudios);
aiRoutes.get('/voices', isAuth, getVoicesList);

export default aiRoutes;