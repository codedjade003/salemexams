import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const DEFAULT_SCRYPT_N = 16384;
const DEFAULT_SCRYPT_R = 8;
const DEFAULT_SCRYPT_P = 1;

function isHex(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]+$/.test(value) && value.length % 2 === 0;
}

export function parseScryptHash(hashValue) {
  if (typeof hashValue !== 'string' || !hashValue) {
    return null;
  }

  const parts = hashValue.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return null;
  }

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltHex = parts[4];
  const digestHex = parts[5];

  if (!Number.isInteger(n) || n <= 1 || !Number.isInteger(r) || r <= 0 || !Number.isInteger(p) || p <= 0) {
    return null;
  }

  if (!isHex(saltHex) || !isHex(digestHex)) {
    return null;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const digest = Buffer.from(digestHex, 'hex');

  if (salt.length < 16 || digest.length < 32) {
    return null;
  }

  return {
    n,
    r,
    p,
    salt,
    digest,
  };
}

export function hashPasswordScrypt(password, options = {}) {
  const n = Number.isInteger(options.n) && options.n > 1 ? options.n : DEFAULT_SCRYPT_N;
  const r = Number.isInteger(options.r) && options.r > 0 ? options.r : DEFAULT_SCRYPT_R;
  const p = Number.isInteger(options.p) && options.p > 0 ? options.p : DEFAULT_SCRYPT_P;
  const salt = Buffer.isBuffer(options.salt)
    ? options.salt
    : randomBytes(Number.isInteger(options.saltBytes) && options.saltBytes >= 16 ? options.saltBytes : 16);

  const digestLength = Number.isInteger(options.digestLength) && options.digestLength >= 32
    ? options.digestLength
    : 64;

  const digest = scryptSync(String(password), salt, digestLength, {
    N: n,
    r,
    p,
  });

  return `scrypt$${n}$${r}$${p}$${salt.toString('hex')}$${digest.toString('hex')}`;
}

export function verifyPasswordScrypt(password, hashValue) {
  const parsed = parseScryptHash(hashValue);
  if (!parsed || typeof password !== 'string') {
    return false;
  }

  try {
    const derived = scryptSync(password, parsed.salt, parsed.digest.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
    });

    return timingSafeEqual(derived, parsed.digest);
  } catch {
    return false;
  }
}
