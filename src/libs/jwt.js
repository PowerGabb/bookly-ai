import jwt from "jsonwebtoken";

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

export const generateAccessToken = (payload) => {
    return jwt.sign(payload, JWT_ACCESS_SECRET, { expiresIn: "2h" });
};

export const verifyAccessToken = (token) => {
    return jwt.verify(token, JWT_ACCESS_SECRET);
};

export const generateRefreshToken = (payload) => {
    return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: "7d" });
};

export const verifyRefreshToken = (token) => {
    return jwt.verify(token, JWT_REFRESH_SECRET);
};



