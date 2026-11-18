import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { S3Deployer, DeployError } from './s3.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'seance-deploy-'));
  await writeFile(path.join(dir, 'index.html'), '<h1>hi</h1>');
  await mkdir(path.join(dir, 'img'));
  await writeFile(path.join(dir, 'img', 'a.gif'), 'GIF89a');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeS3(fail = false) {
  const puts: PutObjectCommand['input'][] = [];
  return {
    puts,
    s3: {
      send: async (cmd: unknown) => {
        if (fail) throw new Error('AccessDenied: secret details');
        puts.push((cmd as PutObjectCommand).input);
        return {};
      },
    },
  };
}

describe('S3Deployer', () => {
  it('uploads every file under sites/<id>/ with content types and returns the URL', async () => {
    const { s3, puts } = fakeS3();
    const d = new S3Deployer({ bucket: 'b', baseUrl: 'https://d1.cloudfront.net/', s3: s3 as never });
    const { url } = await d.deploy('abcdefabcdef', dir);
    expect(url).toBe('https://d1.cloudfront.net/sites/abcdefabcdef/');
    const byKey = Object.fromEntries(puts.map((p) => [p.Key, p]));
    expect(Object.keys(byKey).sort()).toEqual(['sites/abcdefabcdef/img/a.gif', 'sites/abcdefabcdef/index.html']);
    expect(byKey['sites/abcdefabcdef/index.html']!.ContentType).toBe('text/html; charset=utf-8');
    expect(byKey['sites/abcdefabcdef/img/a.gif']!.ContentType).toBe('image/gif');
    expect(puts.every((p) => p.Bucket === 'b')).toBe(true);
  });

  it('rejects a bad site id before uploading anything', async () => {
    const { s3, puts } = fakeS3();
    const d = new S3Deployer({ bucket: 'b', baseUrl: 'https://d1.cloudfront.net', s3: s3 as never });
    await expect(d.deploy('../evil', dir)).rejects.toBeInstanceOf(DeployError);
    expect(puts).toHaveLength(0);
  });

  it('wraps upload errors in DeployError', async () => {
    const { s3 } = fakeS3(true);
    const d = new S3Deployer({ bucket: 'b', baseUrl: 'https://d1.cloudfront.net', s3: s3 as never });
    await expect(d.deploy('abcdefabcdef', dir)).rejects.toBeInstanceOf(DeployError);
  });
});
