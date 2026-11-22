import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
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
  /** Public URL a site id has once deployed. Used to check a reusable earlier build. */
  urlFor(siteId: string): string;
  /** Takedown: delete every published file of a site. Returns how many were deleted. (R11.4) */
  remove(siteId: string): Promise<number>;
}

export interface S3DeployerOptions {
  bucket: string;
  /** Public origin that serves the bucket, e.g. https://dead-link-seance-sites.<sub>.workers.dev */
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
    return { url: this.urlFor(siteId) };
  }

  urlFor(siteId: string): string {
    return `${this.o.baseUrl.replace(/\/+$/, '')}/${this.prefix}/${siteId}/`;
  }

  async remove(siteId: string): Promise<number> {
    if (!/^[a-z0-9]{12}$/.test(siteId)) throw new DeployError('Invalid site id');
    // Only ever this one site's folder: the trailing slash stops "abc" matching "abcd...".
    const Prefix = `${this.prefix}/${siteId}/`;
    let deleted = 0;
    let token: string | undefined;
    do {
      const page = (await this.o.s3.send(
        new ListObjectsV2Command({ Bucket: this.o.bucket, Prefix, ...(token ? { ContinuationToken: token } : {}) }),
      )) as { Contents?: Array<{ Key?: string }>; NextContinuationToken?: string };
      const keys = (page.Contents ?? []).map((c) => c.Key).filter((k): k is string => !!k && k.startsWith(Prefix));
      if (keys.length) {
        await this.o.s3.send(new DeleteObjectsCommand({ Bucket: this.o.bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
        deleted += keys.length;
      }
      token = page.NextContinuationToken;
    } while (token);
    return deleted;
  }
}
