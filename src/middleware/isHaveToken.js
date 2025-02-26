import { errorResponse } from '../libs/errorResponse.js';
import prisma from '../utils/prisma.js';

export const isHaveCredit = (creditType) => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                return next();
            }

            const user = await prisma.user.findUnique({
                where: { id: req.user.id }
            });

            const creditField = creditType === 'AI_CHAT' ? 'ai_credit' : 'tts_credit';

            
            if (!user || user[creditField] <= 0) {
                return errorResponse(res, `Credits ${creditType} Is Not Enough`, 403);
            }

            // Simpan tipe kredit untuk digunakan di controller
            req.creditType = creditType;
            next();
        } catch (error) {
            return errorResponse(res, error.message, 500);
        }
    };
};
