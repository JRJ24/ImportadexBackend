import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import multer from "multer";
import sharp from "sharp";
import { Request, Response, NextFunction } from "express";

const s3Client = new S3Client({
  endpoint: process.env.SPACES_ENDPOINT, 
  region: process.env.SPACES_REGION, 
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID || "",
    secretAccessKey: process.env.ACCESS_SECRET_KEY || "",
  },
});

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req: Request, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Formato no soportado. Solo imágenes y PDFs."));
    }
  },
}).array("files", 10);

export const processAndUpload = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ message: "Error to upload files" });

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return next();

    try {
      const uploadPromises = files.map(async (file) => {
        let fileBuffer = file.buffer;
        let fileName = `claims/${Date.now()}-${file.originalname}`; 
        let contentType = file.mimetype;

        if (file.mimetype.startsWith("image/")) {
          fileName = fileName.split(".")[0] + ".webp";
          contentType = "image/webp";
          fileBuffer = await sharp(file.buffer)
            .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();
        }

        const bucketName = process.env.SPACES_NAME; 

        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: fileName,
            Body: fileBuffer,
            ContentType: contentType,
            ACL: "public-read",
          }),
        );

        
        const finalUrl = `https://${bucketName}.sfo3.digitaloceanspaces.com/${fileName}`;
        
        return finalUrl;
      });

      req.body.imageUrls = await Promise.all(uploadPromises);
      next();
    } catch (err) {
      console.error("Error en subida:", err);
      res.status(500).json({ message: "Error procesando archivos" });
    }
  });
};