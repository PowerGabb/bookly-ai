import express from 'express';
import { getChatHistory } from '../controllers/customerSupportController.js';
import { isAuth } from "../middleware/isAuth.js";
const router = express.Router();

router.get('/chat-history', isAuth, getChatHistory);

export default router;
