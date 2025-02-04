import prisma from '../utils/prisma.js';
import bcrypt from 'bcrypt';
import axios from 'axios';
import { errorResponse } from '../libs/errorResponse.js';
import { successResponse } from '../libs/successResponse.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const sendWhatsAppOTP = async (phone, otp) => {
  try {


    const response = await axios({
      method: 'POST',
      url: 'https://ypkklg.api.infobip.com/whatsapp/1/message/template',
      headers: {
        'Authorization': `App ${process.env.INFOBIP_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      data: {
        "messages": [
          {
            "from": process.env.WHATSAPP_SENDER,
            "to": phone,
            "messageId": Date.now().toString(),
            "content": {
              "templateName": "authentication",
              "templateData": {
                "body": {
                  "placeholders": [otp]
                }
              },
              "language": "id"
            }
          }
        ]
      }
    });
    return response.data;
  } catch (error) {
    console.error('WhatsApp API Error:', error.response?.data || error.message);
    if (error.message === 'TESTING_NUMBER_ONLY') {
      throw new Error('Untuk sementara, verifikasi hanya dapat dilakukan untuk nomor yang terdaftar di sistem');
    }
    throw new Error('Gagal mengirim pesan WhatsApp');
  }
};

const sendOTP = async (phone, otp) => {
  try {
    // Untuk sementara hanya log OTP ke console
    console.log(`OTP untuk nomor ${phone}: ${otp}`);
    
    // Simulasi delay seperti mengirim SMS (1 detik)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return true;
  } catch (error) {
    console.error('Error sending OTP:', error);
    throw new Error('Gagal mengirim OTP');
  }
};

// Konfigurasi multer untuk upload avatar
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/avatars';
    // Buat direktori jika belum ada
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});


export const upload = multer({ 
  storage: storage,
});

export const updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body;
    const userId = req.user.id;
    const avatarFile = req.file;

    // Dapatkan data user yang ada
    const currentUser = await prisma.user.findUnique({
      where: { id: userId }
    });

    // Jika ada avatar baru dan user sudah punya avatar sebelumnya, hapus file lama
    if (avatarFile && currentUser.avatar_url) {
      const oldAvatarPath = path.join(process.cwd(), currentUser.avatar_url);
      if (fs.existsSync(oldAvatarPath)) {
        fs.unlinkSync(oldAvatarPath);
      }
    }

    // Update user dengan avatar baru jika ada
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        email,
        ...(avatarFile && {
          avatar_url: `/${avatarFile.path.replace(/\\/g, '/')}` // Konversi path untuk URL
        })
      },
    });

    return successResponse(res, "Update Profile Success", 200, {
      message: 'Profile updated successfully',
      data: { user: updatedUser }
    });

  } catch (error) {
    // Jika ada error dan file sudah terupload, hapus file
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    return errorResponse(res, error.message, 500);
  }
};

export const sendPhoneOTP = async (req, res) => {
  try {
    const { phone } = req.body;
    const userId = req.user.id;

    // Format nomor telepon (tambahkan 62 jika dimulai dengan 0)
    const formattedPhone = phone.startsWith('0') ? `62${phone.slice(1)}` : phone;

    // Check if phone number is already used by another user
    const existingUser = await prisma.user.findFirst({
      where: {
        AND: [
          { phone: formattedPhone },
          { id: { not: userId } }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Nomor telepon sudah digunakan',
        error: 'PHONE_ALREADY_USED'
      });
    }

    // Generate static OTP for testing
    const otp = "123456"; // Static OTP
    
    try {
      // Log OTP instead of sending
      await sendOTP(formattedPhone, otp);

      // Save OTP to database
      await prisma.otpVerification.create({
        data: {
          user_id: userId,
          phone: formattedPhone,
          otp,
          expires_at: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes expiry
        },
      });

      return res.status(200).json({
        success: true,
        message: 'OTP berhasil dibuat (cek console untuk melihat kode)',
        data: null
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
        error: 'OTP_CREATION_FAILED'
      });
    }

  } catch (error) {
    console.error('Error sending OTP:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat OTP',
      error: error.message
    });
  }
};

export const verifyPhoneOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const userId = req.user.id;

    // Format nomor telepon
    const formattedPhone = phone.startsWith('0') ? `62${phone.slice(1)}` : phone;

    // Check if phone number is already used by another user
    const existingUser = await prisma.user.findFirst({
      where: {
        AND: [
          { phone: formattedPhone },
          { id: { not: userId } }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Nomor telepon sudah digunakan',
        error: 'PHONE_ALREADY_USED'
      });
    }

    const verification = await prisma.otpVerification.findFirst({
      where: {
        user_id: userId,
        phone: formattedPhone,
        otp,
        verified_at: null,
        expires_at: {
          gt: new Date(),
        },
      },
    });

    if (!verification) {
      return res.status(400).json({
        success: false,
        message: 'Kode OTP tidak valid atau sudah kadaluarsa',
        error: 'INVALID_OTP'
      });
    }

    // Mark OTP as verified
    await prisma.otpVerification.update({
      where: { id: verification.id },
      data: { verified_at: new Date() },
    });

    // Update user's phone
    await prisma.user.update({
      where: { id: userId },
      data: { phone: formattedPhone },
    });

    return res.status(200).json({
      success: true,
      message: 'Nomor telepon berhasil diverifikasi',
      data: null
    });

  } catch (error) {
    console.error('Error verifying OTP:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat verifikasi OTP',
      error: error.message
    });
  }
};

export const updatePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    const isValidPassword = await bcrypt.compare(oldPassword, user.password);
    if (!isValidPassword) {
      return errorResponse(res, 'Invalid old password', 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return successResponse(res, {
      message: 'Password updated successfully',
    });
  } catch (error) {
    return errorResponse(res, error.message);
  }
};
