import express from "express";
import { 
  getPackages, 
  getPackage, 
  createPackage, 
  updatePackage, 
  deletePackage 
} from "../controllers/creditPackageController.js";
import { isAuth } from "../middleware/isAuth.js";
import { isAdmin } from "../middleware/isAdmin.js";

const creditPackageRoutes = express.Router();

// Public routes
creditPackageRoutes.get("/", getPackages);
creditPackageRoutes.get("/:id", getPackage);

// Admin only routes
creditPackageRoutes.post("/", isAuth, isAdmin, createPackage);
creditPackageRoutes.put("/:id", isAuth, isAdmin, updatePackage);
creditPackageRoutes.delete("/:id", isAuth, isAdmin, deletePackage);

export default creditPackageRoutes;
