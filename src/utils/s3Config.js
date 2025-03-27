import AWS from 'aws-sdk';
import multerS3 from 'multer-s3';
import path from 'path';

// Konfigurasi AWS
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'ap-southeast-2' // Default ke region Singapore
});

// Buat instance S3
const s3 = new AWS.S3();

// Bucket yang akan digunakan
const bucketName = process.env.AWS_S3_BUCKET_NAME;

// Storage untuk cover image
export const coverImageStorage = multerS3({
    s3: s3,
    bucket: bucketName,
    acl: 'public-read', // File dapat diakses publik
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `covers/${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

// Storage untuk book files
export const bookFileStorage = multerS3({
    s3: s3,
    bucket: bucketName,
    key: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `books/${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

// Storage untuk audio files
export const audioFileStorage = multerS3({
    s3: s3,
    bucket: bucketName,
    acl: 'public-read',
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `audios/${uniqueSuffix}.mp3`);
    }
});

// Storage untuk avatar
export const avatarStorage = multerS3({
    s3: s3,
    bucket: bucketName,
    acl: 'public-read',
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `avatars/avatar-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

// Filter untuk file gambar
export const imageFileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Hanya file gambar yang diizinkan!'), false);
    }
};

// Filter untuk file buku
export const bookFileFilter = (req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.mimetype === "application/epub+zip") {
        cb(null, true);
    } else {
        cb(new Error('Format file tidak valid. Hanya PDF dan EPUB yang diizinkan!'), false);
    }
};

// Upload file langsung ke S3
export const uploadToS3 = (buffer, key) => {
    return new Promise((resolve, reject) => {
        const params = {
            Bucket: bucketName,
            Key: key,
            Body: buffer,
            ACL: 'public-read'
        };
        
        s3.upload(params, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data.Location); // Mengembalikan URL file yang diupload
            }
        });
    });
};

// Hapus file dari S3
export const deleteFromS3 = (key) => {
    return new Promise((resolve, reject) => {
        const params = {
            Bucket: bucketName,
            Key: key
        };
        
        s3.deleteObject(params, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
};

// Mendapatkan key dari URL S3
export const getKeyFromUrl = (url) => {
    if (!url) return null;
    
    try {
        const parsedUrl = new URL(url);
        // Format: https://bucket-name.s3.region.amazonaws.com/path/to/file
        const path = parsedUrl.pathname;
        return path.startsWith('/') ? path.substring(1) : path;
    } catch (error) {
        console.error('Error parsing URL:', error);
        return null;
    }
}; 