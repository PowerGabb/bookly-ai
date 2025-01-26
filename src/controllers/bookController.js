import { errorResponse } from "../libs/errorResponse.js";
import { successResponse } from "../libs/successResponse.js";
import prisma from "../utils/prisma.js";
import fs from "fs";
import path from "path";
import { pdf } from "pdf-to-img";
import Tesseract from "tesseract.js";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

        // Proses file buku
        const fileExtension = path.extname(bookFile.originalname);
        const newFileName = `${bookFile.filename}${fileExtension}`;
        const uploadDir = path.join("uploads", "waiting-process");
        const newFilePath = path.join(uploadDir, newFileName);

        // Buat direktori jika belum ada
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // Pindahkan file buku
        fs.renameSync(bookFile.path, newFilePath);

        // Proses cover image jika ada
        let coverImagePath = null;
        if (coverFile) {
            const coverDir = path.join("uploads", "covers");
            if (!fs.existsSync(coverDir)) {
                fs.mkdirSync(coverDir, { recursive: true });
            }
            coverImagePath = `/uploads/covers/${coverFile.filename}`;
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
                file_url: `/uploads/waiting-process/${newFileName}`,
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
                processBookPages(book.id, book.title, newFilePath);
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
            // Hapus cover lama jika ada
            if (existingBook.coverImage) {
                const oldCoverPath = path.join(process.cwd(), existingBook.coverImage);
                if (fs.existsSync(oldCoverPath)) {
                    fs.unlinkSync(oldCoverPath);
                }
            }
            
            // Set path cover baru
            coverImagePath = `/uploads/covers/${req.files.coverImage[0].filename}`;
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
            // Hapus file PDF lama jika masih ada
            if (existingBook.file_url) {
                const oldPdfPath = path.join(process.cwd(), existingBook.file_url);
                if (fs.existsSync(oldPdfPath)) {
                    fs.unlinkSync(oldPdfPath);
                }
            }

            // Hapus folder processed lama jika ada
            if (existingBook.processed_dir) {
                const oldProcessedDir = path.join(process.cwd(), existingBook.processed_dir);
                if (fs.existsSync(oldProcessedDir)) {
                    fs.rmSync(oldProcessedDir, { recursive: true, force: true });
                }
            }

            // Hapus semua halaman buku dari database
            await prisma.bookPage.deleteMany({
                where: { book_id: parseInt(bookId) }
            });

            // Proses file baru
            const fileExtension = path.extname(bookFile.originalname);
            const newFileName = `${bookFile.filename}${fileExtension}`;
            const newFilePath = path.join(uploadDir, newFileName);

            // Buat direktori jika belum ada
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }

            // Pindahkan file baru
            fs.renameSync(bookFile.path, newFilePath);

            // Tambahkan informasi file baru ke data update
            updateData = {
                ...updateData,
                file_url: `/uploads/waiting-process/${newFileName}`,
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
                processBookPages(updatedBook.id, updatedBook.title, path.join(uploadDir, newFileName));
            });
        }

        return successResponse(res, "Book updated successfully", 200, {
            book: updatedBook
        });

    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

const processBookPages = async (bookId, bookTitle, pdfPath) => {
    try {
        // Buat nama folder yang aman dari karakter khusus
        const safeFolderName = bookTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const outputDir = path.join("uploads", "processed", safeFolderName);
        
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        console.log(`[${bookTitle}] Starting PDF processing...`);

        // Inisialisasi worker Tesseract
        const worker = await Tesseract.createWorker('eng');

        // Buka dokumen PDF
        const document = await pdf(pdfPath, { scale: 2 });
        let pageNumber = 1;

        // Proses setiap halaman
        for await (const imageBuffer of document) {
            try {
                console.log(`[${bookTitle}] Processing page ${pageNumber}`);

                // Simpan gambar ke file
                const fileName = `page-${pageNumber}.png`;
                const imagePath = path.join(outputDir, fileName);
                await fs.promises.writeFile(imagePath, imageBuffer);
                console.log(`[${bookTitle}] Page ${pageNumber} saved as image`);

                // Proses OCR
                console.log(`[${bookTitle}] Starting OCR for page ${pageNumber}`);
                const { data: { text } } = await worker.recognize(imagePath);
                console.log(`[${bookTitle}] OCR completed for page ${pageNumber}`);

                // Simpan ke database dengan URL yang bisa diakses publik
                await prisma.bookPage.create({
                    data: {
                        book_id: bookId,
                        page_number: pageNumber,
                        image_url: `/uploads/processed/${safeFolderName}/${fileName}`,
                        text: text
                    }
                });

                console.log(`[${bookTitle}] Page ${pageNumber} saved to database`);
                pageNumber++;

                // Tunggu sebentar sebelum lanjut ke halaman berikutnya
                await delay(500);

            } catch (error) {
                console.error(`[${bookTitle}] Error processing page ${pageNumber}:`, error);
                await delay(1000);
            }
        }

        // Terminate Tesseract worker
        await worker.terminate();

        // Update status buku setelah selesai
        await prisma.book.update({
            where: { id: bookId },
            data: { 
                processed: true,
                processed_dir: `/uploads/processed/${safeFolderName}`
            }
        });

        console.log(`[${bookTitle}] Processing completed successfully`);

        // Hapus file PDF dari waiting-process
        try {
            if (fs.existsSync(pdfPath)) {
                fs.unlinkSync(pdfPath);
                console.log(`[${bookTitle}] Cleaned up temporary PDF file`);
            }
        } catch (unlinkError) {
            console.error(`[${bookTitle}] Error deleting PDF file:`, unlinkError);
        }

    } catch (error) {
        console.error(`[${bookTitle}] Error processing book pages:`, error);
        
        // Update status error pada buku
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
    const { page, limit, search } = req.query;
    const pageNumber = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    try {
        const books = await prisma.book.findMany({
            where: {
                title: {
                    contains: search || '', // Menambahkan pencarian berdasarkan judul buku
                    mode: 'insensitive' // Pencarian tidak case-sensitive
                }
            },
            include: {
                categories: {
                    include: {
                        category: true
                    }
                }
            },
            skip: (pageNumber - 1) * pageSize,
            take: pageSize
        });
        return successResponse(res, "Books fetched successfully", 200, {
            books,
            page: pageNumber,
            limit: pageSize,
            total: books.length
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const getBookById = async (req, res) => {
    const { bookId } = req.params;
    try {
        const book = await prisma.book.findUnique({
            where: { id: parseInt(bookId) },
            include: {
                categories: {
                    include: {
                        category: true
                    }
                }
            }
        });

        if (!book) {
            return errorResponse(res, "Book not found", 404);
        }

        return successResponse(res, "Book fetched successfully", 200, { book });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

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

        // Hapus file PDF jika masih ada
        if (book.file_url) {
            const pdfPath = path.join(process.cwd(), book.file_url);
            if (fs.existsSync(pdfPath)) {
                fs.unlinkSync(pdfPath);
            }
        }

        // Hapus folder processed jika ada
        if (book.processed_dir) {
            const processedDir = path.join(process.cwd(), book.processed_dir);
            if (fs.existsSync(processedDir)) {
                fs.rmSync(processedDir, { recursive: true, force: true });
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

