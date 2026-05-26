/**
 * GoogleDriveProvider (T154) — a SyncProvider backed by the user's own Google
 * Drive, scope `drive.file`. Stores the encrypted blob as `vault.bin` and the
 * non-secret sidecar as `vault.meta.json` inside a single app-created folder
 * `MoneyTracker/`. It only ever handles ciphertext (contract obligation #1).
 *
 * ⚠️ NOT yet exercised against the live Drive API — it type-checks and follows
 * the Drive v3 REST contract, but the real endpoints/error codes must be verified
 * in a browser before this is trusted. The provider-agnostic engine + framing are
 * unit-tested; this network layer is the part that needs a live run.
 */
import { signIn, signOut as authSignOut, getAccessToken } from './drive-auth';
import {
  AuthenticationError,
  NetworkUnavailableError,
  ConcurrentModificationError,
  ProviderQuotaError,
  type SyncProvider,
  type EncryptedBlob,
  type BlobMetadata,
  type BlobSidecar
} from './types';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = 'MoneyTracker';
const BLOB_NAME = 'vault.bin';
const META_NAME = 'vault.meta.json';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

function token(): string {
  const t = getAccessToken();
  if (t === null) throw new AuthenticationError('drive: not signed in (no valid access token)');
  return t;
}

/** Wrap fetch so a network failure becomes a typed NetworkUnavailableError. */
async function driveFetch(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new NetworkUnavailableError('drive: network request failed (offline?)');
  }
  if (res.status === 401 || res.status === 403) {
    // Distinguish a quota error from an auth error where Drive signals it.
    const body = await res.clone().text();
    if (/storageQuotaExceeded|quota/i.test(body)) {
      throw new ProviderQuotaError('drive: storage quota exceeded');
    }
    throw new AuthenticationError(`drive: not authorized (${res.status})`);
  }
  return res;
}

async function authedJson(url: string): Promise<unknown> {
  const res = await driveFetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error(`drive: ${res.status} ${await res.text()}`);
  return res.json();
}

async function findId(query: string): Promise<string | null> {
  const url = `${DRIVE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`;
  const data = (await authedJson(url)) as { files?: Array<{ id: string }> };
  return data.files && data.files.length > 0 ? (data.files[0]?.id ?? null) : null;
}

async function getFolderId(create: boolean): Promise<string | null> {
  const existing = await findId(
    `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`
  );
  if (existing !== null || !create) return existing;
  const res = await driveFetch(`${DRIVE}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME })
  });
  if (!res.ok) throw new Error(`drive: folder create failed ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

async function fileInfo(name: string, folderId: string): Promise<{ id: string } | null> {
  const id = await findId(`name='${name}' and '${folderId}' in parents and trashed=false`);
  return id === null ? null : { id };
}

async function uploadMedia(
  name: string,
  folderId: string,
  existingId: string | null,
  body: BodyInit,
  contentType: string
): Promise<{ id: string; version: string }> {
  const headers = { Authorization: `Bearer ${token()}`, 'Content-Type': contentType };
  let res: Response;
  if (existingId !== null) {
    res = await driveFetch(`${UPLOAD}/files/${existingId}?uploadType=media&fields=id,version`, {
      method: 'PATCH',
      headers,
      body
    });
  } else {
    // create with metadata in one shot would need multipart; create-then-patch is simpler + still atomic per file
    const created = await driveFetch(`${DRIVE}/files?fields=id`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [folderId] })
    });
    if (!created.ok) throw new Error(`drive: create ${name} failed ${created.status}`);
    const id = ((await created.json()) as { id: string }).id;
    res = await driveFetch(`${UPLOAD}/files/${id}?uploadType=media&fields=id,version`, {
      method: 'PATCH',
      headers,
      body
    });
  }
  if (!res.ok) throw new Error(`drive: upload ${name} failed ${res.status}`);
  const out = (await res.json()) as { id: string; version?: string };
  return { id: out.id, version: out.version ?? '0' };
}

export class GoogleDriveProvider implements SyncProvider {
  readonly id = 'google-drive';
  readonly display_name = 'Google Drive';

  async authenticate(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await signIn();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return getAccessToken() !== null;
  }

  async signOut(): Promise<void> {
    authSignOut();
  }

  async readBlob(): Promise<EncryptedBlob | null> {
    const folderId = await getFolderId(false);
    if (folderId === null) return null;
    const blobFile = await fileInfo(BLOB_NAME, folderId);
    const metaFile = await fileInfo(META_NAME, folderId);
    if (blobFile === null || metaFile === null) return null;
    const blobRes = await driveFetch(`${DRIVE}/files/${blobFile.id}?alt=media`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    if (!blobRes.ok) throw new Error(`drive: read vault.bin failed ${blobRes.status}`);
    const ciphertext = new Uint8Array(await blobRes.arrayBuffer());
    const sidecar = (await authedJson(`${DRIVE}/files/${metaFile.id}?alt=media`)) as BlobSidecar;
    return { ciphertext, sidecar };
  }

  async statBlob(): Promise<BlobMetadata | null> {
    const folderId = await getFolderId(false);
    if (folderId === null) return null;
    const blobFile = await fileInfo(BLOB_NAME, folderId);
    if (blobFile === null) return null;
    const info = (await authedJson(
      `${DRIVE}/files/${blobFile.id}?fields=size,modifiedTime,version`
    )) as { size?: string; modifiedTime?: string; version?: string };
    return {
      size_bytes: Number(info.size ?? 0),
      last_modified: info.modifiedTime ?? new Date().toISOString(),
      version: info.version ?? '0'
    };
  }

  async writeBlob(
    blob: EncryptedBlob,
    if_match_version?: string
  ): Promise<{ new_version: string }> {
    const folderId = await getFolderId(true);
    if (folderId === null) throw new Error('drive: could not resolve app folder');

    // Optimistic concurrency: if a version token was supplied, verify the remote
    // hasn't moved since the caller last looked.
    if (if_match_version !== undefined) {
      const current = await this.statBlob();
      if (current !== null && current.version !== if_match_version) {
        throw new ConcurrentModificationError(
          `drive: remote changed (have ${if_match_version}, remote ${current.version})`
        );
      }
    }

    const blobFile = await fileInfo(BLOB_NAME, folderId);
    const metaFile = await fileInfo(META_NAME, folderId);
    // Upload the ciphertext first, then the sidecar; the ciphertext's version is authoritative.
    const written = await uploadMedia(
      BLOB_NAME,
      folderId,
      blobFile?.id ?? null,
      blob.ciphertext as unknown as BodyInit,
      'application/octet-stream'
    );
    await uploadMedia(
      META_NAME,
      folderId,
      metaFile?.id ?? null,
      JSON.stringify(blob.sidecar),
      'application/json'
    );
    return { new_version: written.version };
  }
}
