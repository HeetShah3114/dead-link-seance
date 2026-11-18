import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { mimeFor } from '../mime.js';

export class DeployError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeployError';
  }
}

/** Publishes a built site folder and returns its public URL. (R8.1, R8.2) */
export interface Deployer {
  deploy(siteId: string, dir: string): Promise<{ url: string }>;
}

export interface S3DeployerOptions {
  bucket: string;
  /** Public origin of the CloudFront distribution, e.g. https://d123.cloudfront.net */
  baseUrl: string;
  /** Key prefix. Matches the bucket lifecycle rule for expiring sites. */
  prefix?: string;
  s3: Pick<S3Client, 'send'>;
}

async function* walk(dir: string, rel = ''): AsyncGenerator<string> {
  for (const entry of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walk(dir, child);
    else if (entry.isFile()) yield child;
  }
}

export class S3Deployer implements Deployer {
  private readonly prefix: string;

  constructor(private readonly o: S3DeployerOptions) {
    this.prefix = o.prefix ?? 'sites';
  }

  async deploy(siteId: string, dir: string): Promise<{ url: string }> {
    if (!/^[a-z0-9]{12}$/.test(siteId)) throw new DeployError('Invalid site id');
    try {
      let count = 0;
      for await (const rel of walk(dir)) {
        await this.o.s3.send(
          new PutObjectCommand({
            Bucket: this.o.bucket,
            Key: `${this.prefix}/${siteId}/${rel}`,
            Body: await readFile(path.join(dir, rel)),
            ContentType: mimeFor(rel),
            CacheControl: 'public, max-age=86400',
          }),
        );
        count++;
      }
      if (count === 0) throw new DeployError('Nothing to upload');
    } catch (e) {
      if (e instanceof DeployError) throw e;
      throw new DeployError(e instanceof Error ? e.message : 'Upload failed');
    }
    return { url: `${this.o.baseUrl.replace(/\/+$/, '')}/${this.prefix}/${siteId}/` };
  }
}
