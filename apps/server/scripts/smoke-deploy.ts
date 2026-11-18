// Manual smoke test for the S3 half of deploy. Usage (credentials via AWS_PROFILE / AWS_REGION):
//   DEPLOY_BUCKET=<bucket> npx tsx apps/server/scripts/smoke-deploy.ts <folder>
import { S3Client } from '@aws-sdk/client-s3';
import { S3Deployer } from '../src/deploy/s3.js';

const bucket = process.env.DEPLOY_BUCKET;
const folder = process.argv[2];
if (!bucket || !folder) {
  console.error('Set DEPLOY_BUCKET and pass a folder.');
  process.exit(2);
}
const deployer = new S3Deployer({
  bucket,
  baseUrl: process.env.DEPLOY_BASE_URL ?? 'https://example.invalid',
  s3: new S3Client({}),
});
const siteId = 'smoketest001';
const { url } = await deployer.deploy(siteId, folder);
console.log(`Uploaded to s3://${bucket}/sites/${siteId}/  (would be served at ${url})`);
