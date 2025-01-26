import express from "express";
import { createCategory, getCategories, deleteCategory, updateCategory } from "../controllers/categoryController.js";
import { isAuth } from "../middleware/isAuth.js";
import { isAdmin } from "../middleware/isAdmin.js";

const categoryRoutes = express.Router();

categoryRoutes.get("/", getCategories);
categoryRoutes.post("/", isAuth, isAdmin, createCategory);
categoryRoutes.delete("/:id", isAuth, isAdmin, deleteCategory);
categoryRoutes.put("/:id", isAuth, isAdmin, updateCategory);

export default categoryRoutes;
