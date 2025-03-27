import express from "express";
import { createBook, getBook, getBookById, getPages, updateBook, deleteBook, getPopularBooks, getRecommendBooks, getLatestBooks, createRating, createRead, createSave, getSaved, getBookRatings, deleteSave, getReadingHistory } from "../controllers/bookController.js";
import multer from "multer";
import { isAuth } from "../middleware/isAuth.js";
import path from "path";
import { coverImageStorage, bookFileStorage, bookFileFilter, imageFileFilter } from "../utils/s3Config.js";

const bookRoutes = express.Router();

// Konfigurasi multer untuk menggunakan S3
const upload = multer({
    storage: multer.memoryStorage(), // Gunakan memory storage untuk fleksibilitas
    fileFilter: (req, file, cb) => {
        if (file.fieldname === "coverImage") {
            imageFileFilter(req, file, cb);
        } else {
            bookFileFilter(req, file, cb);
        }
    }
});

const uploadFields = upload.fields([
    { name: 'bookFile', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 }
]);




bookRoutes.get('/history', isAuth, getReadingHistory);

bookRoutes.get("/home/popular", getPopularBooks);
bookRoutes.get("/home/recommend", getRecommendBooks);
bookRoutes.get("/home/latest", getLatestBooks);

bookRoutes.post("/", isAuth, uploadFields, createBook);
bookRoutes.put("/:bookId", isAuth, uploadFields, updateBook);
bookRoutes.delete("/:bookId", isAuth, deleteBook);
bookRoutes.get("/", getBook);


bookRoutes.get("/:bookId", getBookById);
bookRoutes.get("/:bookId/pages", getPages);
bookRoutes.post("/:bookId/rating", isAuth, createRating);
bookRoutes.get("/:bookId/read", isAuth, createRead);

bookRoutes.post("/:bookId/save", isAuth, createSave);
bookRoutes.delete("/:bookId/save", isAuth, deleteSave);

bookRoutes.get("/book/save", isAuth, getSaved);
bookRoutes.get("/:bookId/ratings", getBookRatings);


export default bookRoutes;