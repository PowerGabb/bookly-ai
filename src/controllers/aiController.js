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
        content: `Anda adalah asisten yang membantu menjawab pertanyaan tentang buku "${page.book.title}" oleh ${page.book.author}. 
                Anda memiliki akses ke seluruh konteks buku dan dapat menjawab pertanyaan dari berbagai halaman.
                Saat ini user sedang membaca halaman ${pageNumber} dengan konten:

                ${page.text}`,
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
        take: 10, // Batasi 10 pesan terakhir untuk performa
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
      content: `[Halaman ${pageNumber}] ${question}`,
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

    return successResponse(res, "Berhasil mendapatkan jawaban", 200, {
      answer: completion,
      pageInfo: {
        bookTitle: page.book.title,
        author: page.book.author,
        pageNumber: page.page_number,
      },
      messageId: savedAIMessage.id,
      hasHistory: messages.length > 2, // Lebih dari system message dan context
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
    speaker = "00151554-3826-11ee-a861-00163e2ac61b",
    emotion = "Neutral",
    style = "default",
  } = req.body;
  const userId = req.user.id;

  try {
    console.log("Starting TTS process with params:", {
      bookId,
      pageNumber,
      speaker,
      emotion,
      style,
    });

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

    console.log("Page content length:", page.text.length);

    // Gunakan GPT untuk memperbaiki teks
    let improvedText = page.text;
    if (style !== "default") {
      console.log("Improving text with GPT...");
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Anda adalah ahli dalam mengoptimalkan teks untuk dibacakan. 
                        Sesuaikan teks berikut untuk gaya pembacaan "${style}" tanpa mengubah makna aslinya.
                        Tambahkan tanda baca yang sesuai untuk memudahkan pembacaan.`,
          },
          {
            role: "user",
            content: page.text,
          },
        ],
        max_tokens: 500,
      });

      improvedText = completion.choices[0].message.content;
      console.log("Improved text length:", improvedText.length);
    }

    // Pecah teks menjadi bagian-bagian 500 karakter
    const textChunks = improvedText.match(/.{1,500}(\s|$)/g) || [];
    console.log("Number of chunks:", textChunks.length);
    const audioUrls = [];
    let speakerName = "";

    // Proses setiap chunk
    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      console.log(`Processing chunk ${i + 1}/${textChunks.length}, length: ${chunk.length}`);
      
      try {
        const response = await makeRequestWithRetry(chunk, speaker, emotion);
        console.log(`Chunk ${i + 1} response:`, response.data);
        audioUrls.push(response.data.data.oss_url);
        if (!speakerName) speakerName = response.data.data.name;
        
        // Tambahkan delay antara requests
        if (i < textChunks.length - 1) {
          await delay(1000); // Tunggu 1 detik antara requests
        }
      } catch (chunkError) {
        console.error(`Error processing chunk ${i + 1}:`, chunkError.response?.data || chunkError.message);
        throw chunkError;
      }
    }

    console.log("All chunks processed, saving to database...");

    // Simpan semua URL audio ke database
    const audioRecords = await Promise.all(
      audioUrls.map((url, index) =>
        prisma.bookAudio.create({
          data: {
            user_id: userId,
            book_id: parseInt(bookId),
            page_number: parseInt(pageNumber),
            file_url: url,
            voice: speakerName,
            style: style,
            part: index + 1,
          },
        })
      )
    );

    console.log("Successfully saved to database");

    return successResponse(res, "Berhasil menghasilkan audio", 200, {
      audioUrls: audioUrls,
      pageInfo: {
        bookTitle: page.book.title,
        author: page.book.author,
        pageNumber: page.page_number,
        improvedText: improvedText,
        speakerName: speakerName,
        totalParts: audioUrls.length,
      },
      audioIds: audioRecords.map((record) => record.id),
    });
  } catch (error) {
    console.error("Error in textToSpeech:", {
      message: error.message,
      response: error.response?.data,
      stack: error.stack,
    });

    if (error.response?.status === 422) {
      return errorResponse(
        res,
        "Format request tidak valid: " + JSON.stringify(error.response.data),
        422
      );
    }

    return errorResponse(
      res,
      `Terjadi kesalahan pada server: ${error.message}`,
      500
    );
  }
};

// Endpoint untuk mendapatkan daftar audio yang sudah dibuat
export const getPageAudios = async (req, res) => {
  const { bookId, pageNumber } = req.params;
  const userId = req.user.id;

  try {
    const audios = await prisma.bookAudio.findMany({
      where: {
        user_id: userId,
        book_id: parseInt(bookId),
        page_number: parseInt(pageNumber),
      },
      orderBy: {
        created_at: "desc",
      },
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
