import prisma from "../utils/prisma.js";
import { successResponse } from "../libs/successResponse.js";
import { errorResponse } from "../libs/errorResponse.js";
import axios from "axios";

// Sync voices dari TopMediai API
export const syncVoices = async (req, res) => {
    try {
        // Verifikasi koneksi Prisma
        try {
            await prisma.$connect();
            console.log('Prisma connected successfully');
        } catch (prismaError) {
            console.error('Prisma connection error:', prismaError);
            throw new Error('Database connection failed');
        }

        const response = await axios.get('https://api.topmediai.com/v1/voices_list', {
            headers: {
                'x-api-key': process.env.TOPMEDIAI_API_KEY,
                'Accept': 'application/json'
            }
        });

        if (!response.data?.Voice) {
            throw new Error('Invalid response structure from TopMediai API');
        }

        const voices = response.data.Voice;
        console.log('Voices to sync:', voices.length);

        // Proses satu per satu untuk menghindari masalah transaksi
        const results = [];
        for (const voice of voices) {
            try {
                const classArray = voice.classnamearray.split(',');
                const gender = classArray[classArray.length - 1].trim();
                const description = classArray[0].trim();

                const result = await prisma.voice.upsert({
                    where: { speaker_id: voice.speaker },
                    update: {
                        name: voice.name,
                        language: voice.Languagename,
                        gender: gender,
                        classification: voice.classification,
                        description: description,
                    },
                    create: {
                        name: voice.name,
                        speaker_id: voice.speaker,
                        language: voice.Languagename,
                        gender: gender,
                        classification: voice.classification,
                        description: description,
                    }
                });
                results.push(result);
            } catch (upsertError) {
                console.error('Error upserting voice:', voice.name, upsertError);
            }
        }

        console.log('Sync completed, voices updated:', results.length);

        return successResponse(res, "Voices synced successfully", 200, {
            totalSynced: results.length
        });
    } catch (error) {
        console.error("Error syncing voices:", error);
        return errorResponse(res, error.message || "Failed to sync voices", 500);
    } finally {
        await prisma.$disconnect();
    }
};

// Get voices dengan pagination dan search
export const getVoices = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            search = "", 
            language,
            classification,
            gender 
        } = req.query;

        const pageNumber = parseInt(page);
        const pageSize = parseInt(limit);

        // Build where clause
        const where = {
            AND: [
                search ? {
                    OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { language: { contains: search, mode: 'insensitive' } },
                        { classification: { contains: search, mode: 'insensitive' } }
                    ]
                } : {},
                language ? { language } : {},
                classification ? { classification } : {},
                gender ? { gender } : {}
            ]
        };

        // Get total count
        const total = await prisma.voice.count({ where });

        // Get voices
        const voices = await prisma.voice.findMany({
            where,
            orderBy: {
                name: 'asc'
            },
            skip: (pageNumber - 1) * pageSize,
            take: pageSize,
            select: {
                id: true,
                name: true,
                speaker_id: true,
                language: true,
                gender: true,
                classification: true,
                description: true
            }
        });

        return successResponse(res, "Voices retrieved successfully", 200, {
            voices,
            pagination: {
                page: pageNumber,
                limit: pageSize,
                totalItems: total,
                totalPages: Math.ceil(total / pageSize)
            }
        });
    } catch (error) {
        console.error("Error getting voices:", error);
        return errorResponse(res, "Failed to get voices", 500);
    }
}; 