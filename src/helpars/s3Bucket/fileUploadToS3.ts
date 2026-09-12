import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import fs from "fs";
import multer from "multer";
import path from "path";
import config from "../../config";
import { fileFilter } from "../file/fileFilter";

// Initialize S3 client
export const s3Client = new S3Client({
  region: "sfo3",
  endpoint: "https://sfo3.digitaloceanspaces.com",
  credentials: {
    accessKeyId: config.aws.accessKeyId as string,
    secretAccessKey: config.aws.secretAccessKey as string,
  },
});

/**
 * Multipart Upload Handler (For Very Large Files)
 * @param {string} folder - Folder name in S3
 * @param {string} originalName - Original file name
 * @param {string} mimeType - File MIME type
 * @param {string} filePath - Local file path for the file
 * @returns {Promise<string>} - The public S3 URL of the uploaded file
 */

export const fileUploadToS3 = async (
  title: string,
  folder: string,
  originalName: string,
  mimeType: string,
  filePath: string
): Promise<string> => {
  const bucketName = config.aws.bucketName;
  if (!bucketName) {
    throw new Error("S3 bucket name is not defined in the configuration.");
  }

  const fileName = `${folder}/${title}_${originalName}`;
  const fileStream = fs.createReadStream(filePath);

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: fileStream,
    ContentType: mimeType,
    ACL: "public-read",
  });

  try {
    await s3Client.send(command);
    return `https://${bucketName}.sfo3.digitaloceanspaces.com/${fileName}`;
  } catch (error) {
    console.error("S3 Multipart Upload Error:", error);
    throw new Error("Failed to upload large file to S3");
  } finally {
    fs.unlinkSync(filePath); // Remove temporary file
  }
};
/**
 * Multer configuration for in-memory and disk storage options
 */
export const s3Uploader = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = path.join(__dirname, "../../../uploads");
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${file.originalname}`;
      cb(null, uniqueSuffix);
    },
  }),
  fileFilter: fileFilter,
  limits: {
    fileSize: 1 * 1024 * 1024 * 1024, // 1GB max file size
  },
});




// import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
// import fs from "fs";
// import multer from "multer";
// import path from "path";

// // ===== Validate .env =====
// if (!process.env.AWS_REGION) throw new Error("AWS_REGION is missing in .env");
// if (!process.env.AWS_BUCKET_NAME) throw new Error("AWS_BUCKET_NAME is missing in .env");
// if (!process.env.AWS_ENDPOINT) throw new Error("AWS_ENDPOINT is missing in .env");
// if (!process.env.AWS_ACCESS_KEY_ID) throw new Error("AWS_ACCESS_KEY_ID is missing in .env");
// if (!process.env.AWS_SECRET_ACCESS_KEY) throw new Error("AWS_SECRET_ACCESS_KEY is missing in .env");

// // ===== Initialize S3 client =====
// export const s3Client = new S3Client({
//   region: process.env.AWS_REGION,
//   endpoint: `https://${process.env.AWS_ENDPOINT}`,
//   forcePathStyle: true, // required for S3-compatible services
//   credentials: {
//     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
//   },
// });

// // ===== File Upload Function =====
// export const fileUploadToS3 = async (
//   title: string,
//   folder: string,
//   originalName: string,
//   mimeType: string,
//   filePath: string
// ): Promise<string> => {
//   const bucketName = process.env.AWS_BUCKET_NAME!;
//   const fileName = `${folder}/${title}_${originalName}`;
//   const fileStream = fs.createReadStream(filePath);

//   const command = new PutObjectCommand({
//     Bucket: bucketName,
//     Key: fileName,
//     Body: fileStream,
//     ContentType: mimeType,
//     ACL: "public-read",
//   });

//   try {
//     await s3Client.send(command);
//     return `https://${bucketName}.${process.env.AWS_ENDPOINT}/${fileName}`;
//   } catch (err) {
//     console.error("ZenEx S3 Upload Error:", err);
//     throw new Error("Failed to upload file to ZenEx Cloud");
//   } finally {
//     if (fs.existsSync(filePath)) fs.unlinkSync(filePath); // remove temp file
//   }
// };

// // ===== Multer Local Storage (temp) =====
// export const s3Uploader = multer({
//   storage: multer.diskStorage({
//     destination: (req, file, cb) => {
//       const uploadPath = path.join(__dirname, "../../../uploads");
//       if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
//       cb(null, uploadPath);
//     },
//     filename: (req, file, cb) => {
//       const uniqueSuffix = `${Date.now()}-${file.originalname}`;
//       cb(null, uniqueSuffix);
//     },
//   }),
//   limits: {
//     fileSize: 1 * 1024 * 1024 * 1024, // 1GB
//   },
// });
