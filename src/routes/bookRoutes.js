import express from "express";
import { createBook, getBook, getBookById, getPages, updateBook, deleteBook } from "../controllers/bookController.js";
import multer from "multer";
import { isAuth } from "../middleware/isAuth.js";
import path from "path";

const bookRoutes = express.Router();

// Konfigurasi multer untuk menyimpan file
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (file.fieldname === "coverImage") {
            cb(null, "uploads/covers/");
        } else {
            cb(null, "uploads/");
        }
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    if (file.fieldname === "coverImage") {
        // Hanya izinkan file gambar untuk cover
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diizinkan untuk cover!'), false);
        }
    } else {
        // Untuk file buku (PDF/EPUB)
        if (file.mimetype === "application/pdf" || file.mimetype === "application/epub+zip") {
            cb(null, true);
        } else {
            cb(new Error('Format file tidak valid. Hanya PDF dan EPUB yang diizinkan!'), false);
        }
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter
});

const uploadFields = upload.fields([
    { name: 'bookFile', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 }
]);

bookRoutes.post("/", isAuth, uploadFields, createBook);
bookRoutes.put("/:bookId", isAuth, uploadFields, updateBook);
bookRoutes.delete("/:bookId", isAuth, deleteBook);
bookRoutes.get("/", getBook);
bookRoutes.get("/:bookId", getBookById);
bookRoutes.get("/:bookId/pages", getPages);

export default bookRoutes;