import { errorResponse } from "../libs/errorResponse.js";

export const isAdmin = (req, res, next) => {
      
    if (req.user.role !== "admin") {
        return errorResponse(res, "unauthorized", 401);
    }
    next();
}