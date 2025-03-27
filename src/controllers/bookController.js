import { errorResponse } from "../libs/errorResponse.js";
import { successResponse } from "../libs/successResponse.js";
import prisma from "../utils/prisma.js";
import fs from "fs";
import path from "path";
import { getTextExtractor } from 'office-text-extractor';
import { readFile } from 'node:fs/promises';
import sharp from "sharp";
import { createRequire } from 'module';
import OpenAI from "openai";
import { uploadToS3, deleteFromS3, getKeyFromUrl } from "../utils/s3Config.js";
import axios from "axios";
const require = createRequire(import.meta.url);
const pdfImgConvert = require('pdf-img-convert');

const openai = new OpenAI({
    apiKey: process.env.OPENAPI_KEY,
});

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fungsi untuk memperbaiki teks menggunakan OpenAI
const improveText = async (text) => {
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are an expert in fixing messy or corrupted text.
                    Your tasks are:
                    1. Improve text formatting for better readability.
                    2. Correct punctuation errors.
                    3. Fix broken or incomplete words.
                    4. Preserve the original meaning of the text.
                    5. Remove unnecessary characters.
                    6. Adjust sentence structure if needed.
                    
                    Provide the corrected text in a clean and readable format with no additional comments—only the improved text.`
                },
                {
                    role: "user",
                    content: text
                }
            ],
            max_tokens: 1000            
        });

        return completion.choices[0].message.content;
    } catch (error) {
        console.error("Error improving text:", error);
        return text; // Jika gagal, kembalikan teks asli
    }
};

export const createBook = async (req, res) => {
    const {
        title,
        author,
        description,
        isbn,
        publisher,
        publicationYear,
        language,
        pageCount,
        categoryIds
    } = req.body;

    console.log(req.files);

    if (!req.files || !req.files.bookFile) {
        return errorResponse(res, "File buku harus diunggah", 400);
    }

    const bookFile = req.files.bookFile[0];
    const coverFile = req.files.coverImage ? req.files.coverImage[0] : null;

    if (bookFile.mimetype !== "application/pdf" && bookFile.mimetype !== "application/epub+zip") {
        return errorResponse(res, "Tipe file tidak valid. Hanya file PDF dan EPUB yang diizinkan", 400);
    }

    try {
        // Cek buku yang sudah ada berdasarkan title atau ISBN
        const existingBook = await prisma.book.findFirst({
            where: {
                OR: [
                    { title: title },
                    { isbn: isbn }
                ]
            }
        });

        if (existingBook) {
            return errorResponse(res, "Buku dengan judul atau ISBN yang sama sudah ada", 400);
        }

        // Upload file buku ke S3
        const fileExtension = path.extname(bookFile.originalname);
        const bookKey = `books/${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExtension}`;
        const bookUrl = await uploadToS3(bookFile.buffer, bookKey);

        // Upload cover image ke S3 jika ada
        let coverImagePath = null;
        if (coverFile) {
            const coverExtension = path.extname(coverFile.originalname);
            const coverKey = `covers/${Date.now()}-${Math.round(Math.random() * 1E9)}${coverExtension}`;
            coverImagePath = await uploadToS3(coverFile.buffer, coverKey);
        }

        const book = await prisma.book.create({
            data: {
                title,
                author,
                description,
                isbn,
                publisher,
                publicationYear: publicationYear ? parseInt(publicationYear) : null,
                language,
                pageCount: pageCount ? parseInt(pageCount) : null,
                coverImage: coverImagePath,
                file_url: bookUrl,
                ...(categoryIds && categoryIds.length > 0 ? {
                    categories: {
                        create: categoryIds.map(id => ({
                            category: {
                                connect: {
                                    id: parseInt(id)
                                }
                            }
                        }))
                    }
                } : {})
            },
            include: {
                categories: {
                    include: {
                        category: true
                    }
                }
            }
        });

        // Kirim response sukses ke user terlebih dahulu
        successResponse(res, "Book created successfully", 200, {
            book
        });

        // Mulai proses konversi PDF ke gambar
        if (fileExtension.toLowerCase() === '.pdf') {
            setImmediate(() => {
                processBookPages(book.id, book.title, book.file_url);
            });
        }

    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const updateBook = async (req, res) => {
    const { bookId } = req.params;
    const {
        title,
        author,
        description,
        isbn,
        publisher,
        publicationYear,
        language,
        pageCount,
        categoryIds
    } = req.body;

    try {
        const existingBook = await prisma.book.findUnique({
            where: { id: parseInt(bookId) }
        });

        if (!existingBook) {
            return errorResponse(res, "Buku tidak ditemukan", 404);
        }

        // Handle cover image update
        let coverImagePath = existingBook.coverImage;
        if (req.files && req.files.coverImage) {
            // Hapus cover lama dari S3 jika ada
            if (existingBook.coverImage) {
                const oldCoverKey = getKeyFromUrl(existingBook.coverImage);
                if (oldCoverKey) {
                    try {
                        await deleteFromS3(oldCoverKey);
                    } catch (error) {
                        console.error("Error deleting old cover:", error);
                    }
                }
            }

            // Upload cover baru ke S3
            const coverFile = req.files.coverImage[0];
            const coverExtension = path.extname(coverFile.originalname);
            const coverKey = `covers/${Date.now()}-${Math.round(Math.random() * 1E9)}${coverExtension}`;
            coverImagePath = await uploadToS3(coverFile.buffer, coverKey);
        }

        let updateData = {
            title: title || existingBook.title,
            author: author || existingBook.author,
            description: description || existingBook.description,
            isbn: isbn || existingBook.isbn,
            publisher: publisher || existingBook.publisher,
            publicationYear: publicationYear ? parseInt(publicationYear) : existingBook.publicationYear,
            language: language || existingBook.language,
            pageCount: pageCount ? parseInt(pageCount) : existingBook.pageCount,
            coverImage: coverImagePath
        };

        // Update kategori hanya jika categoryIds dikirimkan dan memiliki nilai
        if (categoryIds !== undefined && Array.isArray(categoryIds)) {
            // Hapus semua relasi kategori yang ada
            await prisma.bookCategory.deleteMany({
                where: { book_id: parseInt(bookId) }
            });

            // Tambahkan relasi kategori baru jika ada
            if (categoryIds.length > 0) {
                updateData.categories = {
                    create: categoryIds.map(id => ({
                        category: {
                            connect: {
                                id: parseInt(id)
                            }
                        }
                    }))
                };
            }
        }

        // Handle book file update
        if (req.files && req.files.bookFile) {
            const bookFile = req.files.bookFile[0];
            
            // Hapus file PDF lama dari S3 jika masih ada
            if (existingBook.file_url) {
                const oldFileKey = getKeyFromUrl(existingBook.file_url);
                if (oldFileKey) {
                    try {
                        await deleteFromS3(oldFileKey);
                    } catch (error) {
                        console.error("Error deleting old file:", error);
                    }
                }
            }

            // Hapus semua halaman buku dari database
            await prisma.bookPage.deleteMany({
                where: { book_id: parseInt(bookId) }
            });

            // Upload file baru ke S3
            const fileExtension = path.extname(bookFile.originalname);
            const bookKey = `books/${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExtension}`;
            const bookUrl = await uploadToS3(bookFile.buffer, bookKey);

            // Tambahkan informasi file baru ke data update
            updateData = {
                ...updateData,
                file_url: bookUrl,
                processed: false,
                processed_dir: null,
                error_message: null
            };
        }

        // Update buku dengan semua perubahan
        const updatedBook = await prisma.book.update({
            where: { id: parseInt(bookId) },
            data: updateData,
            include: {
                categories: {
                    include: {
                        category: true
                    }
                }
            }
        });

        // Jika ada file baru dan itu PDF, mulai proses konversi
        if (req.files && req.files.bookFile && path.extname(req.files.bookFile[0].originalname).toLowerCase() === '.pdf') {
            setImmediate(() => {
                processBookPages(updatedBook.id, updatedBook.title, updatedBook.file_url);
            });
        }

        return successResponse(res, "Book updated successfully", 200, {
            book: updatedBook
        });

    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

const processBookPages = async (bookId, bookTitle, fileUrl) => {
    try {
        console.log(`[${bookTitle}] Starting PDF processing...`);

        // Buat instance TextExtractor
        const extractor = getTextExtractor();

        // Dapatkan file dari S3 atau HTTP URL
        let buffer;
        if (fileUrl.startsWith('http')) {
            // Jika URL adalah URL dari S3 atau HTTP lainnya
            const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
            buffer = Buffer.from(response.data);
        } else {
            // Bila masih menggunakan path lokal (untuk backward compatibility)
            buffer = await readFile(fileUrl);
        }

        // Ekstrak teks dari buffer PDF
        const text = await extractor.extractText({ input: buffer, type: 'buffer' });
        
        // Split teks menjadi halaman-halaman (berdasarkan karakter newline)
        const pages = text.split('\n\n')
            .map(page => page.trim());

        // Simpan setiap halaman ke database, termasuk yang kosong
        for (let i = 0; i < pages.length; i++) {
            const pageNumber = i + 1; // Mulai dari halaman 1
            console.log(`[${bookTitle}] Processing page ${pageNumber} of ${pages.length}`);
            
            let pageText = pages[i].length > 0 ? pages[i] : null;
            
            // Jika halaman memiliki teks, perbaiki menggunakan OpenAI
            if (pageText) {
                console.log(`[${bookTitle}] Improving text for page ${pageNumber}...`);
                pageText = await improveText(pageText);
            }
            
            await prisma.bookPage.create({
                data: {
                    book_id: bookId,
                    page_number: pageNumber,
                    text: pageText
                }
            });
        }

        // Update status buku
        await prisma.book.update({
            where: { id: bookId },
            data: {
                processed: true,
                processed_dir: null
            }
        });

    } catch (error) {
        console.error(`[${bookTitle}] Error processing book:`, error);
        await prisma.book.update({
            where: { id: bookId },
            data: {
                processed: false,
                error_message: error.message
            }
        });
    }
}

export const getBook = async (req, res) => {
    const { page, limit, search, categories, sort } = req.query;
    const pageNumber = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    try {
        // Siapkan filter untuk pencarian
        let whereClause = {};

        // Filter berdasarkan judul atau author jika ada search
        if (search) {
            whereClause.OR = [
                {
                    title: {
                        contains: search,
                        mode: 'insensitive'
                    }
                },
                {
                    author: {
                        contains: search,
                        mode: 'insensitive'
                    }
                },
                {
                    description: {
                        contains: search,
                        mode: 'insensitive'
                    }
                }
            ];
        }

        // Filter berdasarkan kategori jika ada
        if (categories) {
            const categoryIds = categories.split(',').map(id => parseInt(id));
            whereClause.categories = {
                some: {
                    category_id: {
                        in: categoryIds
                    }
                }
            };
        }

        // Siapkan pengurutan
        let orderBy = [];
        if (sort) {
            switch (sort) {
                case 'newest':
                    orderBy.push({ createdAt: 'desc' });
                    break;
                case 'oldest':
                    orderBy.push({ createdAt: 'asc' });
                    break;
                case 'title-asc':
                    orderBy.push({ title: 'asc' });
                    break;
                case 'title-desc':
                    orderBy.push({ title: 'desc' });
                    break;
                case 'rating-desc':
                case 'rating-asc':
                    // Tidak menggunakan orderBy di sini karena akan diurutkan setelah fetch
                    orderBy.push({ createdAt: 'desc' }); // default sort
                    break;
                default:
                    orderBy.push({ createdAt: 'desc' });
            }
        } else {
            orderBy.push({ createdAt: 'desc' });
        }

        const books = await prisma.book.findMany({
            where: whereClause,
            include: {
                categories: {
                    include: {
                        category: true
                    }
                },
                ratings: true,
                reads: true
            },
            orderBy,
            skip: (pageNumber - 1) * pageSize,
            take: pageSize
        });

        // Transform data dan hitung rata-rata rating
        let transformedBooks = books.map(book => {
            // Hitung rata-rata rating
            const totalRating = book.ratings.reduce((sum, rating) => sum + rating.rating, 0);
            const averageRating = book.ratings.length > 0
                ? parseFloat((totalRating / book.ratings.length).toFixed(1))
                : 0;

            // Hapus array ratings dan reads dari hasil
            const { ratings, reads, ...bookData } = book;

            return {
                ...bookData,
                averageRating,
                totalReads: reads.length,
                totalRatings: ratings.length
            };
        });

        // Urutkan berdasarkan rating jika diperlukan
        if (sort === 'rating-desc') {
            transformedBooks.sort((a, b) => b.averageRating - a.averageRating);
        } else if (sort === 'rating-asc') {
            transformedBooks.sort((a, b) => a.averageRating - b.averageRating);
        }

        // Hitung total items dengan filter yang sama
        const totalItems = await prisma.book.count({
            where: whereClause
        });

        return successResponse(res, "Books fetched successfully", 200, {
            books: transformedBooks,
            pagination: {
                page: pageNumber,
                limit: pageSize,
                totalItems,
                totalPages: Math.ceil(totalItems / pageSize)
            }
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const getBookById = async (req, res) => {
    const { bookId } = req.params;
    
    try {
        const book = await prisma.book.findUnique({
            where: {
                id: parseInt(bookId) // Konversi string ke integer
            },
            include: {
                categories: {
                    include: {
                        category: true
                    }
                },
                ratings: true,
                reads: true
            }
        });

        if (!book) {
            return errorResponse(res, "Buku tidak ditemukan", 404);
        }

        // Hitung rata-rata rating
        const averageRating = book.ratings.length > 0
            ? book.ratings.reduce((acc, curr) => acc + curr.rating, 0) / book.ratings.length
            : 0;

        // Format response
        const formattedBook = {
            ...book,
            averageRating: parseFloat(averageRating.toFixed(1)),
            totalRatings: book.ratings.length,
            totalReads: book.reads.length,
            ratings: undefined, // Hapus data rating mentah
            reads: undefined // Hapus data reads mentah
        };

        return successResponse(res, "Buku berhasil diambil", 200, {
            book: formattedBook
        });
    } catch (error) {
        console.error("Error in getBookById:", error);
        return errorResponse(res, error.message, 500);
    }
};

export const getPages = async (req, res) => {
    const { bookId } = req.params;
    try {
        const pages = await prisma.bookPage.findMany({
            where: {
                book_id: parseInt(bookId)
            },
            orderBy: {
                page_number: 'asc'
            }
        });
        return successResponse(res, "Book pages fetched successfully", 200, {
            pages
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const getBookPages = async (req, res) => {
    const { bookId } = req.params;
    try {
        const pages = await prisma.bookPage.findMany({
            where: {
                book_id: parseInt(bookId)
            },
            orderBy: {
                page_number: 'asc'
            }
        });
        return successResponse(res, "Book pages fetched successfully", 200, {
            pages
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const deleteBook = async (req, res) => {
    const { bookId } = req.params;

    try {
        // Cari buku yang akan dihapus
        const book = await prisma.book.findUnique({
            where: { id: parseInt(bookId) }
        });

        if (!book) {
            return errorResponse(res, "Buku tidak ditemukan", 404);
        }

        // Hapus file buku dari S3 jika ada
        if (book.file_url) {
            const fileKey = getKeyFromUrl(book.file_url);
            if (fileKey) {
                try {
                    await deleteFromS3(fileKey);
                } catch (error) {
                    console.error("Error deleting book file:", error);
                }
            }
        }

        // Hapus cover image dari S3 jika ada
        if (book.coverImage) {
            const coverKey = getKeyFromUrl(book.coverImage);
            if (coverKey) {
                try {
                    await deleteFromS3(coverKey);
                } catch (error) {
                    console.error("Error deleting cover image:", error);
                }
            }
        }

        // Hapus semua halaman buku dari database
        await prisma.bookPage.deleteMany({
            where: { book_id: parseInt(bookId) }
        });

        // Hapus buku dari database
        await prisma.book.delete({
            where: { id: parseInt(bookId) }
        });

        return successResponse(res, "Buku berhasil dihapus", 200);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const getPopularBooks = async (req, res) => {
    const { page, limit } = req.query;
    const pageNumber = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    try {
        // Ambil total jumlah buku untuk pagination
        const totalBooks = await prisma.book.count();

        const books = await prisma.book.findMany({
            include: {
                reads: true,
                categories: {
                    include: {
                        category: true
                    }
                }
            },
            orderBy: {
                reads: {
                    _count: 'desc'
                }
            },
            skip: (pageNumber - 1) * pageSize,
            take: pageSize
        });

        return successResponse(res, "Buku populer berhasil diambil", 200, {
            books: books.map(book => ({
                ...book,
                readCount: book.reads.length
            })),
            pagination: {
                page: pageNumber,
                limit: pageSize,
                totalItems: totalBooks,
                totalPages: Math.ceil(totalBooks / pageSize)
            }
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const getRecommendBooks = async (req, res) => {
    const { page, limit } = req.query;
    const pageNumber = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    try {
        // Hitung total buku untuk pagination
        const totalBooks = await prisma.book.count();

        const books = await prisma.book.findMany({
            include: {
                ratings: true,
                categories: {
                    include: {
                        category: true
                    }
                }
            },
            orderBy: {
                ratings: {
                    _count: 'desc'
                }
            },
            skip: (pageNumber - 1) * pageSize,
            take: pageSize
        });

        // Hitung rata-rata rating untuk setiap buku
        const booksWithAvgRating = books.map(book => {
            const totalRating = book.ratings.reduce((sum, rating) => sum + rating.rating, 0);
            const averageRating = book.ratings.length > 0
                ? totalRating / book.ratings.length
                : 0;

            return {
                ...book,
                ratingCount: book.ratings.length,
                averageRating: parseFloat(averageRating.toFixed(1))
            };
        });

        // Urutkan buku berdasarkan rata-rata rating tertinggi
        const sortedBooks = booksWithAvgRating.sort((a, b) => b.averageRating - a.averageRating);

        return successResponse(res, "Buku rekomendasi berhasil diambil", 200, {
            books: sortedBooks,
            pagination: {
                page: pageNumber,
                limit: pageSize,
                totalItems: totalBooks,
                totalPages: Math.ceil(totalBooks / pageSize)
            }
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const getLatestBooks = async (req, res) => {
    const { page, limit } = req.query;
    const pageNumber = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    try {
        const books = await prisma.book.findMany({
            orderBy: {
                createdAt: 'desc'
            },
            skip: (pageNumber - 1) * pageSize,
            take: pageSize
        });

        return successResponse(res, "Buku terbaru berhasil diambil", 200, { books });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const createRating = async (req, res) => {
    const { bookId } = req.params;
    const { rating, comment } = req.body;

    if (!rating || isNaN(parseInt(rating))) {
        return errorResponse(res, "Rating harus berupa angka", 400);
    }

    try {
        // Cek apakah buku ada
        const book = await prisma.book.findUnique({
            where: { id: parseInt(bookId) }
        });

        if (!book) {
            return errorResponse(res, "Buku tidak ditemukan", 404);
        }

        // Cek apakah user sudah memberikan rating sebelumnya
        const existingRating = await prisma.bookRating.findFirst({
            where: {
                book_id: parseInt(bookId),
                user_id: req.user.id
            }
        });

        let ratingData;
        if (existingRating) {
            // Update rating yang sudah ada
            ratingData = await prisma.bookRating.update({
                where: { id: existingRating.id },
                data: {
                    rating: parseInt(rating),
                    comment: comment || existingRating.comment
                }
            });
            return successResponse(res, "Rating dan komentar berhasil diperbarui", 200);
        }

        // Buat rating baru
        ratingData = await prisma.bookRating.create({
            data: {
                rating: parseInt(rating),
                comment,
                user: {
                    connect: { id: req.user.id }
                },
                book: {
                    connect: { id: parseInt(bookId) }
                }
            }
        });

        return successResponse(res, "Rating dan komentar berhasil dibuat", 200);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const createRead = async (req, res) => {
    const { bookId } = req.params;
    const userId = req.user.id;

    try {
        // Cek apakah buku ada
        const book = await prisma.book.findUnique({
            where: { id: parseInt(bookId) }
        });

        if (!book) {
            return errorResponse(res, "Buku tidak ditemukan", 404);
        }

        // Cek trial period user
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                createdAt: true,
                subscription_level: true,
                subscription_expire_date: true
            }
        });

        if (!user) {
            return errorResponse(res, "User tidak ditemukan", 404);
        }

        // Hitung selisih hari antara sekarang dan tanggal registrasi
        const registrationDate = new Date(user.createdAt);
        const currentDate = new Date();
        const daysDifference = Math.floor((currentDate - registrationDate) / (1000 * 60 * 60 * 24));

        console.log('Debug trial period:', {
            registrationDate: registrationDate.toISOString(),
            currentDate: currentDate.toISOString(),
            daysDifference,
            subscription_level: user.subscription_level
        });

        // Jika user bukan subscriber dan sudah lewat 14 hari
        if (user.subscription_level === 0 && daysDifference > 14) {
            return errorResponse(res, "Masa trial Anda telah berakhir. Silakan berlangganan untuk melanjutkan membaca.", 403);
        }

        // Cek apakah user sudah membaca buku sebelumnya
        const existingRead = await prisma.bookRead.findFirst({
            where: {
                book_id: parseInt(bookId),
                user_id: userId
            }
        });

        if (existingRead) {
            return successResponse(res, "Buku sudah dibaca", 200);
        }

        await prisma.bookRead.create({
            data: {
                book: {
                    connect: { id: parseInt(bookId) }
                },
                read_at: new Date(),
                user: {
                    connect: { id: userId }
                }
            }
        });

        return successResponse(res, "Buku berhasil dibaca", 200);
    } catch (error) {
        console.error('Error in createRead:', error);
        return errorResponse(res, error.message, 500);
    }
}

export const getBookRatings = async (req, res) => {
    const { bookId } = req.params;
    const { page, limit } = req.query;
    const pageNumber = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    try {
        const ratings = await prisma.bookRating.findMany({
            where: { book_id: parseInt(bookId) },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        avatar_url: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            skip: (pageNumber - 1) * pageSize,
            take: pageSize
        });

        const totalItems = await prisma.bookRating.count({
            where: { book_id: parseInt(bookId) }
        });

        return successResponse(res, "Rating dan komentar berhasil diambil", 200, {
            ratings,
            pagination: {
                page: pageNumber,
                limit: pageSize,
                totalItems,
                totalPages: Math.ceil(totalItems / pageSize)
            }
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const createSave = async (req, res) => {
    const { bookId } = req.params;

    try {
        const existingSaved = await prisma.bookSaved.findFirst({
            where: {
                book_id: parseInt(bookId),
                user_id: req.user.id
            }
        });

        if (existingSaved) {
            return successResponse(res, "Buku sudah disimpan", 200);
        }

        await prisma.bookSaved.create({
            data: {
                book: {
                    connect: { id: parseInt(bookId) }
                },
                user: {
                    connect: { id: req.user.id }
                }
            }
        });

        return successResponse(res, "Buku berhasil disimpan", 200);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const deleteSave = async (req, res) => {
    const { bookId } = req.params;

    try {
        // Cari saved book berdasarkan book_id dan user_id
        const savedBook = await prisma.bookSaved.findFirst({
            where: {
                book_id: parseInt(bookId),
                user_id: req.user.id
            }
        });

        if (!savedBook) {
            return errorResponse(res, "Buku belum disimpan", 404);
        }

        // Hapus saved book berdasarkan id yang ditemukan
        await prisma.bookSaved.delete({
            where: { id: savedBook.id }
        });

        return successResponse(res, "Buku berhasil dihapus dari simpanan", 200);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const getSaved = async (req, res) => {
    const { page, limit } = req.query;
    console.log(req.user);
    const pageNumber = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;
    try {
        const savedBooks = await prisma.bookSaved.findMany({
            where: { user_id: req.user.id },
            include: {
                book: {
                    include: {
                        categories: {
                            include: {
                                category: true
                            }
                        }
                    }
                }
            },
            skip: (pageNumber - 1) * pageSize,
            take: pageSize
        });

        return successResponse(res, "Buku yang disimpan berhasil diambil", 200, { savedBooks });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const getReadingHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Ambil riwayat baca
        const readHistory = await prisma.bookRead.findMany({
            where: {
                user_id: userId
            },
            include: {
                book: {
                    select: {
                        id: true,
                        title: true,
                        author: true,
                        coverImage: true,
                        pageCount: true
                    }
                }
            },
            orderBy: {
                read_at: 'desc'
            }
        });

        // Ambil buku yang disimpan
        const savedBooks = await prisma.bookSaved.findMany({
            where: {
                user_id: userId
            },
            include: {
                book: {
                    select: {
                        id: true,
                        title: true,
                        author: true,
                        coverImage: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        return successResponse(res, "Riwayat berhasil diambil", 200, {
            readHistory: readHistory.map(history => ({
                id: history.book.id,
                title: history.book.title,
                author: history.book.author,
                coverImage: history.book.coverImage,
                lastRead: history.read_at,
                pageCount: history.book.pageCount
            })),
            savedBooks: savedBooks.map(saved => ({
                id: saved.book.id,
                title: saved.book.title,
                author: saved.book.author,
                coverImage: saved.book.coverImage,
                savedAt: saved.createdAt
            }))
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

