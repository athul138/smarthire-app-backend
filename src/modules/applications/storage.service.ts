import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly signedUrlExpiry: number;

  constructor(private readonly config: ConfigService) {
    this.s3 = new S3Client({
      region: config.get('aws.region'),
      credentials: {
        accessKeyId: config.get('aws.accessKeyId') || '',
        secretAccessKey: config.get('aws.secretAccessKey') || '',
      },
    });
    this.bucket = config.get<string>('aws.s3Bucket') || '';
    this.signedUrlExpiry = config.get<number>('aws.s3SignedUrlExpiry', 3600);
  }

  async upload(
    file: Express.Multer.File,
    folder: string = 'resumes',
  ): Promise<{ key: string; contentType: string; size: number }> {
    const ext = file.originalname.split('.').pop();
    const key = `${folder}/${uuidv4()}.${ext}`;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ServerSideEncryption: 'AES256',
        Metadata: {
          originalName: encodeURIComponent(file.originalname),
        },
      });

      await this.s3.send(command);

      this.logger.log(`Uploaded file to S3: ${key}`);
      return { key, contentType: file.mimetype, size: file.size };
    } catch (err) {
      this.logger.error('S3 upload failed', err);
      throw new InternalServerErrorException('File upload failed');
    }
  }

  async getSignedUrl(key: string): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      return await getSignedUrl(this.s3, command, { expiresIn: this.signedUrlExpiry });
    } catch (err) {
      this.logger.error('Failed to generate signed URL', err);
      throw new InternalServerErrorException('Could not generate download URL');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3.send(command);
    } catch (err) {
      this.logger.warn(`Failed to delete S3 object: ${key}`, err);
    }
  }

  private streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

  // async getObject(key: string): Promise<Buffer> {
  //   try {
  //     const command = new GetObjectCommand({
  //       Bucket: this.bucket,
  //       Key: key,
  //     });
  //     const result = await this.s3.send(command);
  //     if (result.Body instanceof Uint8Array) {
  //       return Buffer.from(result.Body);
  //     }
  //     throw new Error('Unexpected body type');
  //   } catch (err) {
  //     this.logger.error(`Failed to get S3 object: ${key}`, err);
  //     throw new InternalServerErrorException('Could not retrieve file');
  //   }
  // }
async getObject(key: string): Promise<Buffer> {
  try {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const result = await this.s3.send(command);

    if (result.Body instanceof Uint8Array) {
      return Buffer.from(result.Body);
    }

    if (result.Body instanceof Readable) {
      return this.streamToBuffer(result.Body);
    }

    if (typeof result.Body === 'string') {
      return Buffer.from(result.Body);
    }

    throw new Error(`Unexpected body type: ${typeof result.Body}`);
  } catch (err) {
    this.logger.error(`Failed to get S3 object: ${key}`, err);
    throw new InternalServerErrorException('Could not retrieve file');
  }
}


}
