import express from "express";
import { isAuth } from "../middleware/isAuth.js";
import { 
  updateProfile, 
  sendPhoneOTP, 
  verifyPhoneOTP,
  updatePassword,
  upload,
  getCurrentUser 
} from "../controllers/profileController.js";

const profileRoutes = express.Router();

profileRoutes.get("/", isAuth, getCurrentUser);

profileRoutes.put("/update", isAuth, upload.single('avatar'), updateProfile);
profileRoutes.post("/send-otp", isAuth, sendPhoneOTP);
profileRoutes.post("/verify-otp", isAuth, verifyPhoneOTP);
profileRoutes.put("/update-password", isAuth, updatePassword);

export default profileRoutes;