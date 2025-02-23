import OpenAI from "openai";
import prisma from "../utils/prisma.js";
import { errorResponse } from "../libs/errorResponse.js";
import { successResponse } from "../libs/successResponse.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

        // Ambil system message jika sudah ada untuk buku ini
        const existingSystemMessage = await prisma.chatHistory.findFirst({
            where: {
                user_id: userId,
                book_id: parseInt(bookId),
                role: 'system'
            }
        });

        if (!existingSystemMessage) {
            // Buat system message baru jika belum ada
            const systemMessage = {
                role: "system",
                content: `Anda adalah asisten yang membantu menjawab pertanyaan tentang buku "${page.book.title}" oleh ${page.book.author}. 
                Anda memiliki akses ke seluruh konteks buku dan dapat menjawab pertanyaan dari berbagai halaman.
                Saat ini user sedang membaca halaman ${pageNumber} dengan konten:

                ${page.text}`
            };

            const savedSystemMessage = await prisma.chatHistory.create({
                data: {
                    user_id: userId,
                    book_id: parseInt(bookId),
                    page_number: parseInt(pageNumber),
                    role: systemMessage.role,
                    content: systemMessage.content
                }
            });

            messages.push(systemMessage);
            currentParentId = savedSystemMessage.id;
        } else {
            messages.push({
                role: existingSystemMessage.role,
                content: existingSystemMessage.content
            });
            currentParentId = existingSystemMessage.id;

            // Update system message dengan konteks halaman saat ini
            const contextUpdate = {
                role: "system",
                content: `Sekarang user sedang membaca halaman ${pageNumber} dengan konten:

                ${page.text}`
            };
            messages.push(contextUpdate);
        }

        // Ambil history chat untuk buku ini (tidak dibatasi per halaman)
        if (parentMessageId) {
            const chatHistory = await prisma.chatHistory.findMany({
                where: {
                    user_id: userId,
                    book_id: parseInt(bookId),
                    role: {
                        not: 'system'
                    }
                },
                orderBy: {
                    created_at: 'asc'
                },
                take: 10 // Batasi 10 pesan terakhir untuk performa
            });

            messages.push(...chatHistory.map(chat => ({
                role: chat.role,
                content: chat.content
            })));
        }

        // Tambahkan pertanyaan user dengan konteks halaman
        const userMessage = { 
            role: "user", 
            content: `[Halaman ${pageNumber}] ${question}` 
        };

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
            messageId: savedAIMessage.id,
            hasHistory: messages.length > 2 // Lebih dari system message dan context
        });

    } catch (error) {
        console.error("Error in askPage:", error);
        return errorResponse(res, "Terjadi kesalahan pada server", 500);
    }
}

export const getChatHistory = async (req, res) => {
    const { bookId } = req.params;
    const userId = req.user.id;

    try {
        const chatHistory = await prisma.chatHistory.findMany({
            where: {
                user_id: userId,
                book_id: parseInt(bookId),
                role: {
                    not: 'system'
                }
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

export const textToSpeech = async (req, res) => {
    const { bookId, pageNumber, voice = "alloy", style = "default" } = req.body;
    const userId = req.user.id;

    if (!bookId || !pageNumber) {
        return errorResponse(res, "BookId dan pageNumber harus diisi", 400);
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

        // Buat prompt untuk gaya pembacaan
        let systemPrompt = "";
        switch (style.toLowerCase()) {
            case "storyteller":
                systemPrompt = "Bacakan dengan gaya pendongeng yang menarik dan ekspresif.";
                break;
            case "professional":
                systemPrompt = "Bacakan dengan gaya profesional dan jelas.";
                break;
            case "casual":
                systemPrompt = "Bacakan dengan gaya santai dan bersahabat.";
                break;
            case "dramatic":
                systemPrompt = "Bacakan dengan gaya dramatis dan penuh emosi.";
                break;
            default:
                systemPrompt = "Bacakan dengan gaya natural dan jelas.";
        }

        // Siapkan teks yang akan dibacakan
        const textToRead = `${systemPrompt}\n\n${page.text}`;

        // Buat direktori untuk menyimpan file audio jika belum ada
        const audioDir = path.join(process.cwd(), "uploads", "audio");
        if (!fs.existsSync(audioDir)) {
            fs.mkdirSync(audioDir, { recursive: true });
        }

        // Generate nama file unik
        const fileName = `${userId}-${bookId}-${pageNumber}-${Date.now()}.mp3`;
        const filePath = path.join(audioDir, fileName);

        // Generate audio menggunakan OpenAI TTS
        const mp3 = await openai.audio.speech.create({
            model: "gpt-4o-mini-audio-preview",
            voice: voice, // alloy, echo, fable, onyx, nova, shimmer
            input: textToRead
        });

        // Simpan buffer audio ke file
        const buffer = Buffer.from(await mp3.arrayBuffer());
        fs.writeFileSync(filePath, buffer);

        // Simpan informasi audio ke database
        const audioRecord = await prisma.bookAudio.create({
            data: {
                user_id: userId,
                book_id: parseInt(bookId),
                page_number: parseInt(pageNumber),
                file_url: `/uploads/audio/${fileName}`,
                voice: voice,
                style: style
            }
        });

        return successResponse(res, "Berhasil menghasilkan audio", 200, {
            audioUrl: `/uploads/audio/${fileName}`,
            pageInfo: {
                bookTitle: page.book.title,
                author: page.book.author,
                pageNumber: page.page_number
            },
            audioId: audioRecord.id
        });

    } catch (error) {
        console.error("Error in textToSpeech:", error);
        return errorResponse(res, "Terjadi kesalahan pada server", 500);
    }
}

// Endpoint untuk mendapatkan daftar audio yang sudah dibuat
export const getPageAudios = async (req, res) => {
    const { bookId, pageNumber } = req.params;
    const userId = req.user.id;

    try {
        const audios = await prisma.bookAudio.findMany({
            where: {
                user_id: userId,
                book_id: parseInt(bookId),
                page_number: parseInt(pageNumber)
            },
            orderBy: {
                created_at: 'desc'
            }
        });

        return successResponse(res, "Berhasil mengambil daftar audio", 200, {
            audios
        });
    } catch (error) {
        console.error("Error in getPageAudios:", error);
        return errorResponse(res, "Terjadi kesalahan pada server", 500);
    }
}