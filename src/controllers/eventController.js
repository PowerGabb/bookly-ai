import { errorResponse } from "../libs/errorResponse.js";
import { successResponse } from "../libs/successResponse.js";
import prisma from "../utils/prisma.js";
import { uploadToS3, deleteFromS3, getKeyFromUrl } from "../utils/s3Config.js";
import path from "path";

export const createEvent = async (req, res) => {
    const { title, link, active, order } = req.body;

    if (!req.file) {
        return errorResponse(res, "Gambar hero harus diunggah", 400);
    }

    try {
        // Upload gambar ke S3
        const fileExtension = path.extname(req.file.originalname);
        const imageKey = `events/event-${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExtension}`;
        const imageUrl = await uploadToS3(req.file.buffer, imageKey);

        const event = await prisma.event.create({
            data: {
                title,
                image_url: imageUrl,
                link,
                active: active === "true" || active === true,
                order: order ? parseInt(order) : 0
            }
        });

        return successResponse(res, "Event berhasil dibuat", 201, { event });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

export const getEvents = async (req, res) => {
    const { page = 1, limit = 10, active } = req.query;
    const pageNumber = parseInt(page);
    const pageSize = parseInt(limit);

    try {
        let whereClause = {};
        if (active !== undefined) {
            whereClause.active = active === "true";
        }

        const events = await prisma.event.findMany({
            where: whereClause,
            orderBy: [
                { order: 'asc' },
                { createdAt: 'desc' }
            ],
            skip: (pageNumber - 1) * pageSize,
            take: pageSize
        });

        const totalItems = await prisma.event.count({ where: whereClause });

        return successResponse(res, "Events berhasil diambil", 200, {
            events,
            pagination: {
                page: pageNumber,
                limit: pageSize,
                totalItems,
                totalPages: Math.ceil(totalItems / pageSize)
            }
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

export const getActiveEvents = async (req, res) => {
    try {
        const events = await prisma.event.findMany({
            where: {
                active: true
            },
            orderBy: [
                { order: 'asc' },
                { createdAt: 'desc' }
            ]
        });

        return successResponse(res, "Events aktif berhasil diambil", 200, { events });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

export const updateEvent = async (req, res) => {
    const { id } = req.params;
    const { title, link, active, order } = req.body;

    try {
        const event = await prisma.event.findUnique({
            where: { id: parseInt(id) }
        });

        if (!event) {
            return errorResponse(res, "Event tidak ditemukan", 404);
        }

        let updateData = {
            title: title || event.title,
            link: link || event.link,
            active: active === "true" || active === true,
            order: order ? parseInt(order) : event.order
        };

        // Jika ada gambar baru, upload ke S3 dan hapus yang lama
        if (req.file) {
            // Hapus gambar lama dari S3 jika ada
            if (event.image_url) {
                const oldImageKey = getKeyFromUrl(event.image_url);
                if (oldImageKey) {
                    try {
                        await deleteFromS3(oldImageKey);
                    } catch (error) {
                        console.error("Error deleting old event image:", error);
                    }
                }
            }

            // Upload gambar baru ke S3
            const fileExtension = path.extname(req.file.originalname);
            const imageKey = `events/event-${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExtension}`;
            const imageUrl = await uploadToS3(req.file.buffer, imageKey);
            
            updateData.image_url = imageUrl;
        }

        const updatedEvent = await prisma.event.update({
            where: { id: parseInt(id) },
            data: updateData
        });

        return successResponse(res, "Event berhasil diperbarui", 200, { event: updatedEvent });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

export const deleteEvent = async (req, res) => {
    const { id } = req.params;

    try {
        const event = await prisma.event.findUnique({
            where: { id: parseInt(id) }
        });

        if (!event) {
            return errorResponse(res, "Event tidak ditemukan", 404);
        }

        // Hapus gambar dari S3 jika ada
        if (event.image_url) {
            const imageKey = getKeyFromUrl(event.image_url);
            if (imageKey) {
                try {
                    await deleteFromS3(imageKey);
                } catch (error) {
                    console.error("Error deleting event image:", error);
                }
            }
        }

        await prisma.event.delete({
            where: { id: parseInt(id) }
        });

        return successResponse(res, "Event berhasil dihapus", 200);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};
