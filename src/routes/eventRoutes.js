import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { isAuth } from "../middleware/isAuth.js";
import { createEvent, getEvents, getActiveEvents, updateEvent, deleteEvent } from "../controllers/eventController.js";

const eventRoutes = express.Router();

// Buat direktori uploads/events jika belum ada
const uploadDir = "uploads";
const eventsDir = "uploads/events";

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

if (!fs.existsSync(eventsDir)) {
    fs.mkdirSync(eventsDir);
}

// Konfigurasi multer untuk upload gambar
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "uploads/events/");
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Hanya file gambar yang diizinkan!'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter
});

// Routes untuk admin
eventRoutes.post("/", isAuth, upload.single('image'), createEvent);
eventRoutes.get("/all", isAuth, getEvents);
eventRoutes.put("/:id", isAuth, upload.single('image'), updateEvent);
eventRoutes.delete("/:id", isAuth, deleteEvent);

// Route publik untuk mendapatkan event aktif
eventRoutes.get("/", getActiveEvents);

export default eventRoutes;
