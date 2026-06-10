"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processAndUpload = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const multer_1 = __importDefault(require("multer"));
const sharp_1 = __importDefault(require("sharp"));
const s3Client = new client_s3_1.S3Client({
    endpoint: process.env.SPACES_ENDPOINT,
    region: process.env.SPACES_REGION,
    credentials: {
        accessKeyId: process.env.ACCESS_KEY_ID || "",
        secretAccessKey: process.env.ACCESS_SECRET_KEY || "",
    },
});
const storage = multer_1.default.memoryStorage();
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/") || file.mimetype === "application/pdf") {
            cb(null, true);
        }
        else {
            cb(new Error("Formato no soportado. Solo imágenes y PDFs."));
        }
    },
}).array("files", 10);
const processAndUpload = async (req, res, next) => {
    upload(req, res, async (err) => {
        if (err)
            return res.status(400).json({ message: "Error to upload files" });
        const files = req.files;
        if (!files || files.length === 0)
            return next();
        try {
            const uploadPromises = files.map(async (file) => {
                let fileBuffer = file.buffer;
                let fileName = `claims/${Date.now()}-${file.originalname}`;
                let contentType = file.mimetype;
                if (file.mimetype.startsWith("image/")) {
                    fileName = fileName.split(".")[0] + ".webp";
                    contentType = "image/webp";
                    fileBuffer = await (0, sharp_1.default)(file.buffer)
                        .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
                        .webp({ quality: 80 })
                        .toBuffer();
                }
                const bucketName = process.env.SPACES_NAME;
                await s3Client.send(new client_s3_1.PutObjectCommand({
                    Bucket: bucketName,
                    Key: fileName,
                    Body: fileBuffer,
                    ContentType: contentType,
                    ACL: "public-read",
                }));
                const finalUrl = `https://${bucketName}.sfo3.digitaloceanspaces.com/${fileName}`;
                return finalUrl;
            });
            req.body.imageUrls = await Promise.all(uploadPromises);
            next();
        }
        catch (err) {
            console.error("Error en subida:", err);
            res.status(500).json({ message: "Error procesando archivos" });
        }
    });
};
exports.processAndUpload = processAndUpload;
