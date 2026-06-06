import { S3Client } from '@aws-sdk/client-s3'

const b2 = new S3Client({
  endpoint: process.env.B2_ENDPOINT,
  region: 'us-east-005',
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY,
  },
  forcePathStyle: true,
})

export const BUCKET = process.env.B2_BUCKET_NAME
export const PUBLIC_URL = process.env.B2_PUBLIC_URL

export default b2
