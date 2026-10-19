import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Private file storage behind a small interface, so the local-disk driver used
 * in development can be swapped for S3/R2/GCS in production without touching
 * business logic.
 *
 * Files are stored under keys the server generates — never under the name the
 * user uploaded — so a filename like `../../etc/passwd` can't escape the
 * storage directory or overwrite another file.
 */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export type StoredFile = {
  key: string;
  sizeBytes: number;
  /** SHA-256 of the content, to detect corruption and identical re-uploads. */
  checksum: string;
};

const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]*$/i;

/** Builds a storage key like `organizations/<org>/uploads/<uuid>.csv`. */
export function newUploadKey(organizationId: string, extension: 'csv' | 'xlsx'): string {
  return `organizations/${organizationId}/uploads/${randomUUID()}.${extension}`;
}

/** Builds a storage key like `organizations/<org>/exports/<uuid>.csv`. */
export function newExportKey(organizationId: string): string {
  return `organizations/${organizationId}/exports/${randomUUID()}.csv`;
}

export function checksum(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..')) {
    throw new Error(`Refusing unsafe storage key: ${key}`);
  }
}

/** Development driver: files on local disk. Most free hosts wipe their disk on restart — use S3 there. */
export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  /** Resolves a key to a path, refusing anything that would land outside the root. */
  private pathFor(key: string): string {
    assertSafeKey(key);
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(this.root + path.sep)) {
      throw new Error(`Storage key escapes the storage root: ${key}`);
    }
    return resolved;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const filePath = this.pathFor(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    // `wx` fails if the file exists: keys are unique, so a clash is a bug, never an overwrite.
    await writeFile(filePath, data, { flag: 'wx', mode: 0o600 });
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

export type S3StorageOptions = {
  bucket: string;
  region: string;
  /** Needed for S3-compatible services such as Cloudflare R2 or Backblaze B2; omit for AWS. */
  endpoint?: string | undefined;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

/**
 * Production driver for any S3-compatible object store (AWS S3, Cloudflare R2,
 * Backblaze B2, MinIO…). The bucket must be private: files are only ever
 * served through the API's authorised download route, never by URL.
 */
export class S3FileStorage implements FileStorage {
  private readonly client: Pick<S3Client, 'send'>;

  constructor(
    private readonly options: S3StorageOptions,
    /** Injectable for tests. */
    client?: Pick<S3Client, 'send'>,
  ) {
    this.client =
      client ??
      new S3Client({
        region: options.region,
        endpoint: options.endpoint,
        forcePathStyle: options.forcePathStyle ?? false,
        credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
      });
  }

  async put(key: string, data: Buffer): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: key, Body: data, ContentLength: data.length }));
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }));
    if (!result.Body) throw new Error(`Empty response for storage key: ${key}`);
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    // S3 deletes are idempotent: deleting a missing key succeeds, like the local driver.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }
}

/** The configured driver: local disk for development, S3-compatible object storage in production. */
export function createStorage(config: { storageDir: string; storage: { driver: 'local' } | ({ driver: 's3' } & S3StorageOptions) }): FileStorage {
  return config.storage.driver === 's3' ? new S3FileStorage(config.storage) : new LocalFileStorage(config.storageDir);
}
