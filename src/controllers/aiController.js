import OpenAI from "openai";
import prisma from "../utils/prisma.js";
import { errorResponse } from "../libs/errorResponse.js";
import { successResponse } from "../libs/successResponse.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import axios from "axios";
import { uploadToS3, deleteFromS3, getKeyFromUrl } from "../utils/s3Config.js";

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

const getSystemPromptForLanguage = (language) => {
  const prompts = {
    en: `You are an AI specialized in converting books into high-quality audiobooks.
         Optimize the following text to make it sound natural and engaging when read aloud in English.
         Add appropriate punctuation, adjust sentence flow, and ensure a smooth, expressive narration.
         Maintain the original meaning while enhancing the listening experience.`,
    in: `Anda adalah AI yang mengonversi buku menjadi audiobook berkualitas tinggi.
         Optimalkan teks berikut agar terdengar natural dan menarik saat dibacakan dalam Bahasa Indonesia.
         Tambahkan tanda baca yang sesuai, sesuaikan alur kalimat, dan pastikan narasi terdengar lancar serta ekspresif.
         Pertahankan makna asli sambil meningkatkan pengalaman mendengarkan.`,
    ja: `あなたは本を高品質のオーディオブックに変換するAIです。
         以下のテキストを、日本語で自然で魅力的に朗読できるように最適化してください。
         適切な句読点を追加し、文の流れを調整し、滑らかで表現豊かなナレーションを実現してください。
         元の意味を保ちながら、聞きやすさを向上させてください。`,
    ko: `당신은 책을 고품질 오디오북으로 변환하는 AI입니다.
         다음 텍스트를 한국어로 자연스럽고 몰입감 있게 들리도록 최적화하세요.
         적절한 구두점을 추가하고 문장 흐름을 조정하며, 부드럽고 표현력 있는 내레이션을 보장하세요.
         원래 의미를 유지하면서도 청취 경험을 향상시키세요.`,
    zh: `您是将书籍转换为高质量有声书的人工智能。
         优化以下文本，使其在朗读时听起来自然、生动且引人入胜。
         添加适当的标点符号，调整句子流畅度，并确保叙述具有表现力。
         在保持原意的同时，提高听觉体验。`,
    de: `Sie sind eine KI, die Bücher in hochwertige Hörbücher umwandelt.
         Optimieren Sie den folgenden Text, damit er beim Vorlesen auf Deutsch natürlich und fesselnd klingt.
         Fügen Sie geeignete Satzzeichen hinzu, passen Sie den Satzfluss an und sorgen Sie für eine flüssige und ausdrucksstarke Erzählweise.
         Bewahren Sie die ursprüngliche Bedeutung, während Sie das Hörerlebnis verbessern.`,
    fr: `Vous êtes une IA spécialisée dans la conversion de livres en livres audio de haute qualité.
         Optimisez le texte suivant pour qu'il sonne naturel et captivant lorsqu'il est lu à haute voix en français.
         Ajoutez la ponctuation appropriée, ajustez le flux des phrases et assurez-vous d'une narration fluide et expressive.
         Préservez le sens original tout en améliorant l'expérience d'écoute.`,
    es: `Eres una IA especializada en convertir libros en audiolibros de alta calidad.
         Optimiza el siguiente texto para que suene natural y atractivo cuando se lea en voz alta en español.
         Agrega la puntuación adecuada, ajusta el flujo de las oraciones y garantiza una narración fluida y expresiva.
         Mantén el significado original mientras mejoras la experiencia auditiva.`,
    it: `Sei un'IA specializzata nella conversione di libri in audiolibri di alta qualità.
         Ottimizza il seguente testo affinché suoni naturale e coinvolgente quando letto ad alta voce in italiano.
         Aggiungi la punteggiatura appropriata, adatta il flusso delle frasi e garantisci una narrazione fluida ed espressiva.
         Mantieni il significato originale migliorando al contempo l'esperienza d'ascolto.`,
    nl: `U bent een AI die boeken omzet in hoogwaardige audioboeken.
         Optimaliseer de volgende tekst zodat deze natuurlijk en boeiend klinkt wanneer hij in het Nederlands wordt voorgelezen.
         Voeg de juiste interpunctie toe, pas de zinsstructuur aan en zorg voor een vloeiende en expressieve vertelling.
         Behoud de oorspronkelijke betekenis terwijl u de luisterervaring verbetert.`,
    ru: `Вы — ИИ, который превращает книги в качественные аудиокниги.
         Оптимизируйте следующий текст, чтобы он звучал естественно и увлекательно при чтении вслух на русском языке.
         Добавьте подходящую пунктуацию, настройте плавность предложений и обеспечьте выразительную, гладкую подачу.
         Сохраните оригинальный смысл, улучшая восприятие на слух.`,
    ar: `أنت ذكاء اصطناعي متخصص في تحويل الكتب إلى كتب صوتية عالية الجودة.
         قم بتحسين النص التالي ليبدو طبيعيًا وجذابًا عند قراءته بصوت عالٍ باللغة العربية.
         أضف علامات الترقيم المناسبة، وقم بضبط تدفق الجمل، وتأكد من أن السرد سلس ومعبر.
         حافظ على المعنى الأصلي مع تحسين تجربة الاستماع.`,
    hi: `आप एक एआई हैं जो किताबों को उच्च-गुणवत्ता वाले ऑडियोबुक में बदलने में विशेषज्ञ हैं।
         निम्नलिखित पाठ को इस तरह अनुकूलित करें कि यह हिंदी में पढ़ने पर स्वाभाविक और आकर्षक लगे।
         उचित विराम चिह्न जोड़ें, वाक्य प्रवाह को समायोजित करें, और सुनिश्चित करें कि वाचन सहज और प्रभावशाली हो।
         मूल अर्थ बनाए रखते हुए सुनने के अनुभव को बेहतर बनाएं।`,
    pt: `Você é uma IA especializada em converter livros em audiolivros de alta qualidade.
         Otimize o seguinte texto para que soe natural e envolvente ao ser lido em voz alta em português.
         Adicione a pontuação adequada, ajuste o fluxo das frases e garanta uma narração fluida e expressiva.
         Mantenha o significado original enquanto melhora a experiência auditiva.`,
    tr: `Siz, kitapları yüksek kaliteli sesli kitaplara dönüştüren bir yapay zekâsınız.
         Aşağıdaki metni, Türkçe olarak yüksek sesle okunduğunda doğal ve akıcı hale getirmek için optimize edin.
         Uygun noktalama işaretlerini ekleyin, cümle akışını ayarlayın ve anlatımı daha etkileyici hale getirin.
         Orijinal anlamı koruyarak dinleme deneyimini iyileştirin.`
  };
  
  return prompts[language] || prompts.en; // Default ke bahasa Inggris jika bahasa tidak ditemukan
};

export const textToSpeech = async (req, res) => {
  const {
    bookId,
    pageNumber,
    speaker,
    style = "default",
    language = "en"
  } = req.body;
  const userId = req.user.id;

  try {
    // Cek apakah user adalah premium untuk custom voice
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        subscription_level: true,
        subscription_expire_date: true
      }
    });

    // Jika bukan premium dan mencoba menggunakan voice selain default
    if (
      (!user.subscription_level || new Date() > new Date(user.subscription_expire_date)) && 
      speaker !== 'alloy'
    ) {
      return errorResponse(
        res, 
        "Fitur custom voice hanya tersedia untuk pengguna premium", 
        403
      );
    }

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

    const systemPrompt = getSystemPromptForLanguage(language);

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
    
    // Upload audio ke S3
    const audioFileName = `audio_${bookId}_${pageNumber}_${language}_${Date.now()}.mp3`;
    const audioKey = `audios/${audioFileName}`;
    const audioUrl = await uploadToS3(buffer, audioKey);

    const audioRecord = await prisma.bookAudio.create({
      data: {
        user_id: userId,
        book_id: parseInt(bookId),
        page_number: parseInt(pageNumber),
        file_url: audioUrl,
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
  const { language = "en", voice = "alloy" } = req.query;  // Tambahkan voice parameter
  console.log(req.query);
  
  try {
    const audios = await prisma.bookAudio.findMany({
      where: {
        book_id: parseInt(bookId),
        page_number: parseInt(pageNumber),
        language: language,
        voice: voice // Tambahkan filter untuk voice
      },
      orderBy: [
        {
          created_at: 'desc'
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
