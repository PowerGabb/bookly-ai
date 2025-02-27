import { Server } from "socket.io";
import { verifyAccessToken } from "../libs/jwt.js";
import prisma from "../utils/prisma.js";
import {
  initializeChat,
  handleUserMessage,
  handleAdminMessage,
  closeChat,
  handleTyping,
} from "../controllers/customerSupportController.js";

const setupCustomerSupportSocket = (server) => {
  const io = new Server(server, {
    // Konfigurasi CORS (Cross-Origin Resource Sharing)
    cors: {
      // Origin menentukan domain yang diizinkan mengakses socket
      // Jika dalam mode production, menggunakan FRONTEND_URL dari env
      // Jika development, mengizinkan localhost:5173 dan 127.0.0.1:5173
      origin: process.env.NODE_ENV === 'production' 
        ? process.env.FRONTEND_URL 
        : ["http://localhost:5173", "http://127.0.0.1:5173"],

      // Methods menentukan HTTP method yang diizinkan
      methods: ["GET", "POST"],

      // Headers yang diizinkan dalam request
      allowedHeaders: ["Content-Type", "Authorization"],

      // Mengizinkan pengiriman credentials (seperti cookies) dalam request
      credentials: true
    },

    // Path endpoint untuk koneksi socket.io
    path: '/socket.io',

    // Transport layer yang digunakan - websocket lebih cepat, polling sebagai fallback
    transports: ['websocket', 'polling']
  });

  // Middleware autentikasi
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        throw new Error("Authentication error");
      }

      // Verifikasi token
      const decoded = verifyAccessToken(token);
      if (!decoded) {
        throw new Error("Invalid token");
      }

      // Ambil data user lengkap dari database
      const user = await prisma.user.findUnique({
        where: {
          id: decoded.id,
        },
        select: {
          id: true,
          email: true,
          role: true,
          name: true,
          avatar_url: true,
        },
      });

      if (!user) {
        throw new Error("User not found");
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.user;

    // Jika user adalah admin, masukkan ke room admin
    if (user.role === "admin") {
      socket.join("admin-room");
    }

    // Initialize chat untuk user
    socket.on("initialize-chat", () => {
      initializeChat(socket, user);
    });

    // Handle pesan dari user
    socket.on("user-message", (data) => {
      handleUserMessage(io, socket, data, user);
    });

    // Handle pesan dari admin
    socket.on("admin-message", (data) => {
      handleAdminMessage(io, socket, data, user);
    });

    // Handle penutupan chat oleh admin
    socket.on("close-chat", (data) => {
      closeChat(io, socket, data, user);
    });

    socket.on('typing', (data) => {
      handleTyping(io, socket, data, user);
    });

    socket.on("disconnect", () => {});

    // Handle error
    socket.on("error", (error) => {});
  });

  return io;
};

export default setupCustomerSupportSocket;
