import { requestValidation } from "../libs/requestValidation.js";
import { loginValidation, registerValidation } from "../validation/authValidation.js";
import { errorResponse } from "../libs/errorResponse.js";
import { comparePassword, hashPassword } from "../libs/bcrypt.js";
import prisma from "../utils/prisma.js";
import { successResponse } from "../libs/successResponse.js";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../libs/jwt.js";
import { sendEmail } from "../libs/nodemailer.js";

export const register = async (req, res) => {
    const validation = requestValidation(registerValidation, req);
    if (!validation.isValid) {
        return errorResponse(res, validation.error, 400);
    }

    try {
        const findUser = await prisma.user.findUnique({
            where: {
                email: req.body.email
            }
        });

        if (findUser) {
            return errorResponse(res, "Email already exists", 400);
        }

        // Generate 6 digit activation token
        const activationToken = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedPassword = await hashPassword(req.body.password);
        const newUser = await prisma.user.create({
            data: {
                name: req.body.name,
                email: req.body.email,
                password: hashedPassword,
                activationToken
            }
        });

        // Kirim email dengan kode aktivasi
        const emailContent = `
            <h1>Aktivasi Akun Anda</h1>
            <p>Halo ${newUser.name},</p>
            <p>Terima kasih telah mendaftar. Berikut adalah kode aktivasi akun Anda:</p>
            <h2>${activationToken}</h2>
            <p>Kode ini akan kadaluarsa dalam 24 jam.</p>
        `;

        await sendEmail(
            newUser.email,
            "Kode Aktivasi Akun Anda",
            emailContent
        );

        return successResponse(res, "Register berhasil, silakan cek email Anda untuk kode aktivasi", 200, {
            id: newUser.id,
            name: newUser.name,
            email: newUser.email,
            role: newUser.role,
            avatar_url: newUser.avatar_url,
            subscription_level: newUser.subscription_level,
            isActive: newUser.isActive,
            createdAt: newUser.createdAt,
            updatedAt: newUser.updatedAt
        });

    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

export const activate = async (req, res) => {
    const { token } = req.body;

    try {
        const user = await prisma.user.findUnique({
            where: {
                activationToken: token
            }
        });

        if (!user) {
            return errorResponse(res, "Kode aktivasi tidak valid atau sudah kadaluarsa", 400);
        }

        if (user.isActive) {
            return errorResponse(res, "Akun sudah aktif", 400);
        }

        await prisma.user.update({
            where: {
                id: user.id
            },
            data: {
                isActive: true,
                activationToken: null
            }
        });

        return successResponse(res, "Aktivasi akun berhasil", 200);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

export const login = async (req, res) => {
    const validation = requestValidation(loginValidation, req);
    if (!validation.isValid) {
        return errorResponse(res, validation.error, 400);
    }

    const { email, password } = req.body;

    try {
        const user = await prisma.user.findUnique({
            where: {
                email
            }
        });

        if (!user) {
            return errorResponse(res, "User not found", 404);
        }

        const isPasswordValid = await comparePassword(password, user.password);
        if (!isPasswordValid) {
            return errorResponse(res, "Invalid password", 400);
        }

        const accessToken = generateAccessToken({ id: user.id });
        const refreshToken = generateRefreshToken({ id: user.id });

        return successResponse(res, "Login success", 200, {
            user: {
                name: user.name,
                email: user.email,
                role: user.role,
                avatar_url: user.avatar_url,
                subscription_level: user.subscription_level,
                isActive: user.isActive,
            },
            accessToken,
            refreshToken
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const refreshToken = async (req, res) => {
    const { refreshToken } = req.body;

    try {
        const decoded = verifyRefreshToken(refreshToken);
        const accessToken = generateAccessToken({ id: decoded.id });

        return successResponse(res, "Refresh token success", 200, {
            accessToken
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}
