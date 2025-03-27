import express from "express";
import multer from "multer";
import { isAuth } from "../middleware/isAuth.js";
import { createEvent, getEvents, getActiveEvents, updateEvent, deleteEvent } from "../controllers/eventController.js";

const eventRoutes = express.Router();

// Konfigurasi multer untuk upload gambar ke S3
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diizinkan!'), false);
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// Routes untuk admin
eventRoutes.post("/", isAuth, upload.single('image'), createEvent);
eventRoutes.get("/all", isAuth, getEvents);
eventRoutes.put("/:id", isAuth, upload.single('image'), updateEvent);
eventRoutes.delete("/:id", isAuth, deleteEvent);

// Route publik untuk mendapatkan event aktif
eventRoutes.get("/", getActiveEvents);

export default eventRoutes;
