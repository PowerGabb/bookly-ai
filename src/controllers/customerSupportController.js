import prisma from "../utils/prisma.js";
import { errorResponse } from "../libs/errorResponse.js";
import { successResponse } from "../libs/successResponse.js";

export const getChatHistory = async (req, res) => {
  try {
    // Untuk admin, ambil semua chat yang aktif
    const isAdmin = req.user.role === 'admin';
    
    let chats;
    if (isAdmin) {
      chats = await prisma.customerSupportChat.findMany({
        where: {
          status: {
            not: 'CLOSED'
          }
        },
        orderBy: {
          created_at: 'asc',
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar_url: true,
            }
          }
        }
      });

      // Kelompokkan chat berdasarkan user
      const chatsByUser = chats.reduce((acc, chat) => {
        if (!acc[chat.user_id]) {
          acc[chat.user_id] = {
            userId: chat.user_id,
            name: chat.user.name,
            email: chat.user.email,
            avatar_url: chat.user.avatar_url,
            messages: [],
            lastMessage: chat.message,
            timestamp: chat.created_at
          };
        }
        acc[chat.user_id].messages.push(chat);
        // Update last message jika chat ini lebih baru
        if (new Date(chat.created_at) > new Date(acc[chat.user_id].timestamp)) {
          acc[chat.user_id].lastMessage = chat.message;
          acc[chat.user_id].timestamp = chat.created_at;
        }
        return acc;
      }, {});

      return successResponse(res, "Chat history retrieved successfully", 200, { 
        chats,
        activeChats: Object.values(chatsByUser)
      });
    } else {
      // Untuk user biasa, hanya ambil chatnya sendiri
      chats = await prisma.customerSupportChat.findMany({
        where: {
          user_id: req.user.id,
          status: {
            not: 'CLOSED'
          }
        },
        orderBy: {
          created_at: 'asc',
        },
        include: {
          user: {
            select: {
              name: true,
              email: true,
            }
          }
        }
      });
      return successResponse(res, "Chat history retrieved successfully", 200, { chats });
    }
  } catch (error) {
    console.error('Error getting chat history:', error);
    return errorResponse(res, error.message, 500);
  }
};

export const initializeChat = async (socket, user) => {
  try {
    // Bergabung ke room spesifik user
    socket.join(`user-${user.id}`);

    // Ambil riwayat chat
    const chats = await prisma.customerSupportChat.findMany({
      where: {
        user: {
          id: user.id
        },
        status: {
          not: 'CLOSED'
        }
      },
      orderBy: {
        created_at: 'asc',
      },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          }
        }
      }
    });

    // Jika tidak ada chat aktif, buat sesi chat baru
    if (chats.length === 0) {
      const newChat = await prisma.customerSupportChat.create({
        data: {
          message: "Sesi chat dimulai",
          is_admin: true,
          status: 'ACTIVE',
          user: {
            connect: {
              id: user.id
            }
          }
        },
        include: {
          user: {
            select: {
              name: true,
              email: true,
            }
          }
        }
      });
      chats.push(newChat);
    }

    // Kirim riwayat chat ke user
    socket.emit('chat-history', chats);
  } catch (error) {
    console.error('Error initializing chat:', error);
    socket.emit('error', { message: error.message });
  }
};

export const handleUserMessage = async (io, socket, data, user) => {
  try {
    const { message } = data;

    // Simpan pesan ke database
    const chat = await prisma.customerSupportChat.create({
      data: {
        message: message,
        is_admin: false,
        status: 'ACTIVE',
        user: {
          connect: {
            id: user.id
          }
        }
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar_url: true,
          }
        }
      }
    });

    // Format pesan untuk konsistensi
    const formattedMessage = {
      ...chat,
      user_id: user.id,
      userId: user.id, // Tambahkan ini untuk konsistensi dengan frontend
    };

    // Broadcast pesan ke admin dan user
    io.to(`user-${user.id}`).emit('new-message', formattedMessage);
    io.to('admin-room').emit('new-user-message', formattedMessage);

  } catch (error) {
    console.error('Error handling user message:', error);
    socket.emit('error', { message: error.message });
  }
};

export const handleAdminMessage = async (io, socket, data, admin) => {
  try {
    const { message, userId } = data;

    // Simpan pesan admin
    const chat = await prisma.customerSupportChat.create({
      data: {
        message,
        is_admin: true,
        status: 'ACTIVE',
        admin_id: admin.id,
        user_id: userId
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar_url: true,
          }
        }
      }
    });

    // Format pesan untuk konsistensi
    const formattedMessage = {
      ...chat,
      userId: userId, // Tambahkan ini untuk konsistensi dengan frontend
    };

    // Kirim pesan ke user dan admin
    io.to(`user-${userId}`).emit('new-message', formattedMessage);
    io.to('admin-room').emit('new-admin-message', formattedMessage);

  } catch (error) {
    console.error('Error handling admin message:', error);
    socket.emit('error', { message: error.message });
  }
};

export const closeChat = async (io, socket, data, admin) => {
  try {
    const { userId } = data;

    // Validasi admin
    if (admin.role !== 'admin') {
      throw new Error('Unauthorized');
    }

    // Update status chat
    await prisma.customerSupportChat.updateMany({
      where: {
        user: {
          id: userId
        },
        status: 'ACTIVE',
      },
      data: {
        status: 'CLOSED',
      },
    });

    // Buat pesan penutup
    const closingMessage = await prisma.customerSupportChat.create({
      data: {
        message: "Sesi chat telah ditutup oleh admin",
        is_admin: true,
        status: 'CLOSED',
        admin_id: admin.id,
        user: {
          connect: {
            id: userId
          }
        }
      },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          }
        }
      }
    });

    // Notifikasi ke user dan admin
    io.to(`user-${userId}`).emit('chat-closed', closingMessage);
    io.to('admin-room').emit('chat-closed', { 
      userId,
      message: closingMessage 
    });

  } catch (error) {
    console.error('Error closing chat:', error);
    socket.emit('error', { message: error.message });
  }
};

// Tambahkan fungsi baru untuk handle typing
export const handleTyping = async (io, socket, data, user) => {
  try {
    const { isTyping, userId } = data;
    
    if (user.role === 'admin') {
      // Admin typing to specific user
      io.to(`user-${userId}`).emit('typing', {
        isTyping,
        userId: user.id,
        isAdmin: true
      });
    } else {
      // User typing to admin
      io.to('admin-room').emit('typing', {
        isTyping,
        userId: user.id,
        userName: user.name,
        isAdmin: false
      });
    }
  } catch (error) {
    console.error('Error handling typing:', error);
  }
};
