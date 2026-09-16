import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { slugify } from "../../../utils/slugify";

import multer from "multer";
import { fileFilter } from "../../../helpars/file/fileFilter";

import config from "../../../config";

export const s3 = new S3Client({
  region: config.aws.region || "sfo3",
  endpoint: `https://${config.aws.region || "sfo3"}.digitaloceanspaces.com`,
  credentials: {
    accessKeyId: config.aws.accessKeyId as string,
    secretAccessKey: config.aws.secretAccessKey as string,
  },
});

export const uploadToS3 = async (folder: string, file: Express.Multer.File) => {
  const ext = file.originalname.split(".").pop();
  const name = slugify(file.originalname.replace(/\.[^/.]+$/, ""));
  const key = `${folder}/${name}-${uuidv4()}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME!,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
          ACL: "private",
    //   ACL: "public-read",
    })
    );
    
    console.log(key);
    return key;

//   return   `https://salmaapp.sfo3.digitaloceanspaces.com/${key}`;
};




export const upload = multer({
  storage: multer.memoryStorage(), // no local folder
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB (optional)
  },
});


import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const getPrivateFileUrl = async (key: string) => {
  const command = new GetObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME!,
    Key: key,
  });

  return await getSignedUrl(s3, command, {
    expiresIn: 60 * 5, // 5 minutes
  });
};
