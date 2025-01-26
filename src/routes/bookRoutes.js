import express from "express";
import { createBook, getBook, getBookById, getPages, updateBook, deleteBook } from "../controllers/bookController.js";
import multer from "multer";
import { isAuth } from "../middleware/isAuth.js";

const bookRoutes = express.Router();
const upload = multer({ dest: "uploads/" });

bookRoutes.post("/", isAuth, upload.single("bookFile"), createBook);
bookRoutes.put("/:bookId", isAuth, upload.single("bookFile"), updateBook);
bookRoutes.delete("/:bookId", isAuth, deleteBook);
bookRoutes.get("/", getBook);
bookRoutes.get("/:bookId", getBookById);
bookRoutes.get("/:bookId/pages", getPages);

export default bookRoutes;