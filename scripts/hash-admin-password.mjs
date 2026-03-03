import { randomBytes, scryptSync } from 'node:crypto';

const DEFAULT_N = 16384;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const KEY_LENGTH = 64;

const password = process.argv[2];

if (!password || password.length < 8) {
  console.error('Usage: node scripts/hash-admin-password.mjs "your-strong-password"');
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const salt = randomBytes(16);
const digest = scryptSync(password, salt, KEY_LENGTH, {
  N: DEFAULT_N,
  r: DEFAULT_R,
  p: DEFAULT_P,
});

const hash = `scrypt$${DEFAULT_N}$${DEFAULT_R}$${DEFAULT_P}$${salt.toString('hex')}$${digest.toString('hex')}`;

console.log('\nADMIN_PASSCODE_HASH=');
console.log(hash);
console.log('\nCopy this into your .env file as:');
console.log(`ADMIN_PASSCODE_HASH=${hash}`);
