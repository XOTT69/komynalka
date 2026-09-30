const PASSWORD_ITERATIONS = 210000;
const PASSWORD_KEY_BYTES = 32;

const encoder = new TextEncoder();

function toHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function fromHex(value) {
  if (typeof value !== 'string' || value.length % 2 || !/^[a-f0-9]+$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g).map(part => Number.parseInt(part, 16)));
}

function randomHex(size = 16) {
  return toHex(crypto.getRandomValues(new Uint8Array(size)));
}

export function passwordPolicy(password) {
  const value = String(password || '');
  if (value.length < 8) return 'PASSWORD_TOO_SHORT';
  if (value.length > 128) return 'PASSWORD_TOO_LONG';
  if (!/[\p{L}\p{N}]/u.test(value)) return 'PASSWORD_TOO_WEAK';
  return null;
}

export function validLogin(login) {
  const value = String(login || '').trim().toLowerCase();
  return value.length >= 2 && value.length <= 80 && /^[\p{L}\p{N}._@+\-]+$/u.test(value);
}

export async function sha256Hex(value) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(String(value)))));
}

async function derive(password, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations}, material, PASSWORD_KEY_BYTES * 8);
  return new Uint8Array(bits);
}

export async function createPasswordVerifier(password) {
  const policyError = passwordPolicy(password);
  if (policyError) throw new Error(policyError);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(String(password), salt, PASSWORD_ITERATIONS);
  return {algorithm: 'PBKDF2-SHA256', iterations: PASSWORD_ITERATIONS, salt: toHex(salt), hash: toHex(hash)};
}

export async function verifyPassword(password, verifier) {
  if (!verifier || verifier.algorithm !== 'PBKDF2-SHA256') return false;
  const salt = fromHex(verifier.salt), expected = fromHex(verifier.hash);
  const iterations = Number(verifier.iterations);
  if (!salt || !expected || expected.length !== PASSWORD_KEY_BYTES || !Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) return false;
  const actual = await derive(String(password), salt, iterations);
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < Math.max(actual.length, expected.length); i++) diff |= (actual[i] || 0) ^ (expected[i] || 0);
  return diff === 0;
}

export function createOpaqueToken(bytes = 32) {
  return randomHex(bytes);
}

export function sessionToken(login) {
  const encoded = btoa(unescape(encodeURIComponent(String(login)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `s1.${encoded}.${createOpaqueToken(32)}`;
}

export function parseSessionToken(token) {
  const match = /^s1\.([A-Za-z0-9_-]{3,160})\.([a-f0-9]{64})$/.exec(String(token || ''));
  if (!match) return null;
  try {
    const base = match[1].replace(/-/g, '+').replace(/_/g, '/');
    // Preserve the canonical key casing of imported legacy accounts. New logins are
    // lowercase, but older KV keys may be mixed-case and belong to a different DO.
    const login = decodeURIComponent(escape(atob(base + '='.repeat((4 - base.length % 4) % 4)))).trim();
    return validLogin(login) ? {login, token: match[0]} : null;
  } catch { return null; }
}
