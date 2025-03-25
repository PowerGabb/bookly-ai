import OpenAI from "openai";
import prisma from "../utils/prisma.js";
import { errorResponse } from "../libs/errorResponse.js";
import { successResponse } from "../libs/successResponse.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAPI_KEY,
});

// Tambahkan fungsi delay helper
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Tambahkan fungsi untuk mencoba request dengan retry
const makeRequestWithRetry = async (chunk, speaker, emotion, retries = 3, baseDelay = 1000) => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.post(
                "https://api.topmediai.com/v1/text2speech",
                {
                    text: chunk.trim(),
                    speaker: speaker,
                    emotion: emotion,
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                        "x-api-key": process.env.TOPMEDIAI_API_KEY,
                        "Accept": "application/json"
                    },
                    timeout: 30000, // 30 detik timeout
                }
            );
            return response;
        } catch (error) {
            console.error(`Attempt ${i + 1} failed:`, error.message);
            if (i === retries - 1) throw error; // Throw error jika ini attempt terakhir
            await delay(baseDelay * Math.pow(2, i)); // Exponential backoff
        }
    }
};

const decrementCredit = async (userId, creditType) => {
    // Cek user subscription terlebih dahulu
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            subscription_level: true,
            ai_credit: true,
            tts_credit: true,
            subscription_expire_date: true
        }
    });

    // Jika user adalah pro/premium dan masih dalam masa berlaku
    if (user.subscription_level > 0 && new Date() < new Date(user.subscription_expire_date)) {
        return creditType === 'AI_CHAT' ? user.ai_credit : user.tts_credit;
    }

    // Jika bukan pro/premium atau sudah expired, kurangi kredit
    const creditField = creditType === 'AI_CHAT' ? 'ai_credit' : 'tts_credit';
    const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
            [creditField]: {
                decrement: 1
            }
        },
        select: {
            ai_credit: true,
            tts_credit: true
        }
    });
    
    return creditType === 'AI_CHAT' ? updatedUser.ai_credit : updatedUser.tts_credit;
};

export const askPage = async (req, res) => {
  const { bookId, pageNumber, question, parentMessageId } = req.body;
  const userId = req.user.id;

  if (!bookId || !pageNumber || !question) {
    return errorResponse(
      res,
      "BookId, pageNumber, dan pertanyaan harus diisi",
      400
    );
  }

  try {
    // Ambil konten halaman dari database
    const page = await prisma.bookPage.findFirst({
      where: {
        book_id: parseInt(bookId),
        page_number: parseInt(pageNumber),
      },
      include: {
        book: {
          select: {
            title: true,
            author: true,
          },
        },
      },
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
        role: "system",
      },
    });

    if (!existingSystemMessage) {
      // Buat system message baru jika belum ada
      const systemMessage = {
        role: "system",
        content: `You are an assistant helping to answer questions about the book "${page.book.title}" by ${page.book.author}.
                You have access to the entire book context and can answer questions from various pages.
                Currently the user is reading page ${pageNumber} with content:

                ${page.text}

                Please respond in the same language as the user's question - if they ask in Indonesian, respond in Indonesian. If they ask in English, respond in English.`,
      };

      const savedSystemMessage = await prisma.chatHistory.create({
        data: {
          user_id: userId,
          book_id: parseInt(bookId),
          page_number: parseInt(pageNumber),
          role: systemMessage.role,
          content: systemMessage.content,
        },
      });

      messages.push(systemMessage);
      currentParentId = savedSystemMessage.id;
    } else {
      messages.push({
        role: existingSystemMessage.role,
        content: existingSystemMessage.content,
      });
      currentParentId = existingSystemMessage.id;

      // Update system message dengan konteks halaman saat ini
      const contextUpdate = {
        role: "system",
        content: `Sekarang user sedang membaca halaman ${pageNumber} dengan konten:

                ${page.text}`,
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
            not: "system",
          },
        },
        orderBy: {
          created_at: "asc",
        },
        take: 5, // Batasi 10 pesan terakhir untuk performa
      });

      messages.push(
        ...chatHistory.map((chat) => ({
          role: chat.role,
          content: chat.content,
        }))
      );
    }

    // Tambahkan pertanyaan user dengan konteks halaman
    const userMessage = {
      role: "user",
      content: question
    };

    // Simpan pertanyaan user ke database
    const savedUserMessage = await prisma.chatHistory.create({
      data: {
        user_id: userId,
        book_id: parseInt(bookId),
        page_number: parseInt(pageNumber),
        parent_message_id: currentParentId,
        role: userMessage.role,
        content: userMessage.content,
      },
    });

    messages.push(userMessage);

    // Kirim ke OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
      max_tokens: 500,
    });

    // Simpan response AI ke database
    const savedAIMessage = await prisma.chatHistory.create({
      data: {
        user_id: userId,
        book_id: parseInt(bookId),
        page_number: parseInt(pageNumber),
        parent_message_id: savedUserMessage.id,
        role: completion.choices[0].message.role,
        content: completion.choices[0].message.content,
      },
    });

    // Kurangi kredit dan dapatkan sisa kredit
    const remainingCredits = await decrementCredit(userId, req.creditType);

    return successResponse(res, "Berhasil mendapatkan jawaban", 200, {
      answer: completion,
      pageInfo: {
        bookTitle: page.book.title,
        author: page.book.author,
        pageNumber: page.page_number,
      },
      messageId: savedAIMessage.id,
      hasHistory: messages.length > 2, // Lebih dari system message dan context
      remainingCredits // Tambahkan sisa kredit ke response
    });
  } catch (error) {
    console.error("Error in askPage:", error);
    return errorResponse(res, "Terjadi kesalahan pada server", 500);
  }
};

export const getChatHistory = async (req, res) => {
  const { bookId } = req.params;
  const userId = req.user.id;

  try {
    const chatHistory = await prisma.chatHistory.findMany({
      where: {
        user_id: userId,
        book_id: parseInt(bookId),
        role: {
          not: "system",
        },
      },
      orderBy: {
        created_at: "asc",
      },
    });

    return successResponse(res, "Berhasil mengambil history chat", 200, {
      history: chatHistory,
    });
  } catch (error) {
    console.error("Error in getChatHistory:", error);
    return errorResponse(res, "Terjadi kesalahan pada server", 500);
  }
};

export const textToSpeech = async (req, res) => {
  const {
    bookId,
    pageNumber,
    speaker,
    style = "default",
    language = "en"  // Default bahasa Inggris
  } = req.body;
  const userId = req.user.id;

  try {
    const page = await prisma.bookPage.findFirst({
      where: {
        book_id: parseInt(bookId),
        page_number: parseInt(pageNumber),
      },
      include: {
        book: {
          select: {
            title: true,
            author: true,
          },
        },
      },
    });

    if (!page) {
      return errorResponse(res, "Halaman tidak ditemukan", 404);
    }

    // Sesuaikan prompt berdasarkan bahasa
    const systemPrompt = language === "in" 
      ? `Anda adalah ahli dalam mengoptimalkan teks Bahasa Indonesia untuk dibacakan. 
         Sesuaikan teks berikut agar lebih natural dan enak didengar dalam Bahasa Indonesia.
         Tambahkan tanda baca yang sesuai dan perbaiki struktur kalimat jika perlu.
         Pastikan teks tetap mempertahankan makna aslinya namun lebih mengalir saat dibacakan.`
      : `You are an expert in optimizing English text for speech.
         Adjust the following text to make it more natural and pleasant to hear in English.
         Add appropriate punctuation and improve sentence structure if needed.
         Ensure the text maintains its original meaning while flowing better when spoken.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: page.text,
        },
      ],
    });

    const improvedText = completion.choices[0].message.content;

    const audioResponse = await openai.audio.speech.create({
      model: "tts-1",
      voice: speaker,
      input: improvedText,
    });

    const buffer = Buffer.from(await audioResponse.arrayBuffer());
    const audioFileName = `audio_${bookId}_${pageNumber}_${language}_${Date.now()}.mp3`;
    const audioPath = path.join("uploads", "audios", audioFileName);
    
    if (!fs.existsSync(path.join("uploads", "audios"))) {
      fs.mkdirSync(path.join("uploads", "audios"), { recursive: true });
    }

    fs.writeFileSync(audioPath, buffer);

    const audioRecord = await prisma.bookAudio.create({
      data: {
        user_id: userId,
        book_id: parseInt(bookId),
        page_number: parseInt(pageNumber),
        file_url: `/uploads/audios/${audioFileName}`,
        voice: speaker,
        style: style,
        language: language,
        part: 1,
      },
    });

    // Kurangi kredit dan dapatkan sisa kredit
    const remainingCredits = await decrementCredit(userId, req.creditType);

    return successResponse(res, "Berhasil menghasilkan audio", 200, {
      audio: audioRecord,
      pageInfo: {
        bookTitle: page.book.title,
        author: page.book.author,
        pageNumber: page.page_number,
        improvedText: improvedText,
      },
      remainingCredits // Tambahkan sisa kredit ke response
    });

  } catch (error) {
    console.error("Error in textToSpeech:", error);
    return errorResponse(
      res,
      `Terjadi kesalahan pada server: ${error.message}`,
      500
    );
  }
};

// Update getPageAudios untuk menambahkan filter language
export const getPageAudios = async (req, res) => {
  const { bookId, pageNumber } = req.params;
  const { language = "en" } = req.query;  // Default ke bahasa Inggris
  console.log(req.query);
  try {
    const audios = await prisma.bookAudio.findMany({
      where: {
        book_id: parseInt(bookId),
        page_number: parseInt(pageNumber),
        language: language
      },
      orderBy: [
        {
          voice: 'asc',
        },
        {
          part: 'asc',
        }
      ],
    });

    return successResponse(res, "Berhasil mengambil daftar audio", 200, {
      audios,
    });
  } catch (error) {
    console.error("Error in getPageAudios:", error);
    return errorResponse(res, "Terjadi kesalahan pada server", 500);
  }
};

// Tambahkan fungsi controller baru
export const getVoicesList = async (req, res) => {
    try {
        const response = await axios.get('https://api.topmediai.com/v1/voices_list', {
            headers: {
                'x-api-key': process.env.TOPMEDIAI_API_KEY,
                'Accept': 'application/json'
            }
        });

        const voices = response.data;


        return successResponse(res, "Berhasil mendapatkan daftar voice", 200, {
            voices,
        });
    } catch (error) {
        console.error("Error getting voices list:", error.response?.data || error.message);
        return errorResponse(res, "Gagal mendapatkan daftar voice", 500);
    }
};
