import { verifyAccessToken } from '../libs/jwt.js';
import { errorResponse } from '../libs/errorResponse.js';
import prisma from '../utils/prisma.js';
export const isAuth = async (req, res, next) => {
    try {
        if (!req.headers.authorization) {
            return errorResponse(res, 'Token is required', 401);
        }
        const token = req.headers.authorization.split(' ')[1];

        const decoded = verifyAccessToken(token);
        if (!decoded) {
            return errorResponse(res, 'Invalid token', 401);
        }


        const user = await prisma.user.findUnique({
            where: {
                id: decoded.id,
            },
        });
        req.user = user;
        next();
    } catch (error) {
        return errorResponse(res, error.message || 'Invalid token', 401);
    }
};