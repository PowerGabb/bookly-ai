import express from "express";
import { isAuth } from "../middleware/isAuth.js";
import { 
  updateProfile, 
  sendPhoneOTP, 
  verifyPhoneOTP,
  updatePassword,
  upload 
} from "../controllers/profileController.js";

const profileRoutes = express.Router();

profileRoutes.get("/", isAuth, (req, res) => {
    return res.json({
        data: "Hello World"
    })
});

profileRoutes.put("/update", isAuth, upload.single('avatar'), updateProfile);
profileRoutes.post("/send-otp", isAuth, sendPhoneOTP);
profileRoutes.post("/verify-otp", isAuth, verifyPhoneOTP);
profileRoutes.put("/update-password", isAuth, updatePassword);

export default profileRoutes;