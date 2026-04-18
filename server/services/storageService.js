import fs from 'fs';
import path from 'path';

export async function storeFile({ filePath, jobId, format, storage }) {
  if (storage === 's3') {
    return uploadToS3({ filePath, jobId, format });
  }

  const filename = path.basename(filePath);
  return { url: `/exports/${filename}`, storage: 'local' };
}

async function uploadToS3({ filePath, jobId, format }) {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.S3_BUCKET_NAME) {
    throw new Error('Missing AWS S3 environment variables');
  }

  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const ext = format === 'gif' ? 'gif' : format === 'webm' ? 'webm' : 'mp4';
  const key = `exports/${jobId}.${ext}`;
  const contentTypeMap = { mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif' };

  const fileStream = fs.createReadStream(filePath);
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    Body: fileStream,
    ContentType: contentTypeMap[format] || 'video/mp4',
    ...(process.env.PUBLIC_S3_EXPORTS === 'true' ? { ACL: 'public-read' } : {}),
  });

  await client.send(command);

  const url = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;

  if (process.env.DELETE_LOCAL_AFTER_S3 === 'true') {
    fs.unlinkSync(filePath);
  }

  return { url, storage: 's3' };
}
