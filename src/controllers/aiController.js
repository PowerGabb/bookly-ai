import OpenAI from "openai";
import prisma from "../utils/prisma.js";
import { errorResponse } from "../libs/errorResponse.js";
import { successResponse } from "../libs/successResponse.js";

const openai = new OpenAI({
    apiKey: process.env.OPENAPI_KEY
});

export const askPage = async (req, res) => {
    const { bookId, pageNumber, question, parentMessageId } = req.body;
    const userId = req.user.id;

    if (!bookId || !pageNumber || !question) {
        return errorResponse(res, "BookId, pageNumber, dan pertanyaan harus diisi", 400);
    }

    try {
        // Ambil konten halaman dari database
        const page = await prisma.bookPage.findFirst({
            where: {
                book_id: parseInt(bookId),
                page_number: parseInt(pageNumber)
            },
            include: {
                book: {
                    select: {
                        title: true,
                        author: true
                    }
                }
            }
        });

        if (!page) {
            return errorResponse(res, "Halaman tidak ditemukan", 404);
        }

        // Siapkan messages untuk OpenAI
        let messages = [];
        let currentParentId = null;

        // Coba ambil chat terakhir untuk buku dan halaman ini
        const lastChat = await prisma.chatHistory.findFirst({
            where: {
                user_id: userId,
                book_id: parseInt(bookId),
                page_number: parseInt(pageNumber)
            },
            orderBy: {
                created_at: 'desc'
            }
        });

        if (parentMessageId || (lastChat && !parentMessageId)) {
            // Gunakan parentMessageId yang diberikan atau ID chat terakhir
            currentParentId = parentMessageId || lastChat.id;
            
            // Ambil history chat dari database
            const chatHistory = await prisma.chatHistory.findMany({
                where: {
                    user_id: userId,
                    book_id: parseInt(bookId),
                    page_number: parseInt(pageNumber)
                },
                orderBy: {
                    created_at: 'asc'
                },
                take: 10 // Batasi 10 pesan terakhir untuk performa
            });

            if (chatHistory.length > 0) {
                messages = chatHistory.map(chat => ({
                    role: chat.role,
                    content: chat.content
                }));
            }
        }

        // Jika tidak ada history atau history kosong, buat context baru
        if (messages.length === 0) {
            const systemMessage = {
                role: "system",
                content: `Anda adalah asisten yang membantu menjawab pertanyaan tentang buku "${page.book.title}" oleh ${page.book.author}. 
                Gunakan konten berikut sebagai referensi untuk menjawab pertanyaan:

                ${page.text}`
            };

            // Simpan system message ke database
            const savedSystemMessage = await prisma.chatHistory.create({
                data: {
                    user_id: userId,
                    book_id: parseInt(bookId),
                    page_number: parseInt(pageNumber),
                    role: systemMessage.role,
                    content: systemMessage.content
                }
            });

            messages = [systemMessage];
            currentParentId = savedSystemMessage.id;
        }

        // Tambahkan pertanyaan user
        const userMessage = { role: "user", content: question };
        
        // Simpan pertanyaan user ke database
        const savedUserMessage = await prisma.chatHistory.create({
            data: {
                user_id: userId,
                book_id: parseInt(bookId),
                page_number: parseInt(pageNumber),
                parent_message_id: currentParentId,
                role: userMessage.role,
                content: userMessage.content
            }
        });

        messages.push(userMessage);

        // Kirim ke OpenAI
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: messages,
            max_tokens: 500
        });

        // Simpan response AI ke database
        const savedAIMessage = await prisma.chatHistory.create({
            data: {
                user_id: userId,
                book_id: parseInt(bookId),
                page_number: parseInt(pageNumber),
                parent_message_id: savedUserMessage.id,
                role: completion.choices[0].message.role,
                content: completion.choices[0].message.content
            }
        });

        return successResponse(res, "Berhasil mendapatkan jawaban", 200, {
            answer: completion,
            pageInfo: {
                bookTitle: page.book.title,
                author: page.book.author,
                pageNumber: page.page_number
            },
            messageId: savedAIMessage.id, // ID untuk referensi spesifik
            hasHistory: messages.length > 1 // Indikator apakah ada history chat
        });

    } catch (error) {
        console.error("Error in askPage:", error);
        return errorResponse(res, "Terjadi kesalahan pada server", 500);
    }
}

// Tambahkan endpoint baru untuk mengambil history chat
export const getChatHistory = async (req, res) => {
    const { bookId, pageNumber } = req.params;
    const userId = req.user.id;

    try {
        const chatHistory = await prisma.chatHistory.findMany({
            where: {
                user_id: userId,
                book_id: parseInt(bookId),
                page_number: parseInt(pageNumber)
            },
            orderBy: {
                created_at: 'asc'
            }
        });

        return successResponse(res, "Berhasil mengambil history chat", 200, {
            history: chatHistory
        });
    } catch (error) {
        console.error("Error in getChatHistory:", error);
        return errorResponse(res, "Terjadi kesalahan pada server", 500);
    }
}