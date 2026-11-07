import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
function keyBytes(key: string) {
  const bytes = Buffer.from(key, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== key)
    throw new Error('Invalid encryption key');
  return bytes;
}
export function encrypt(value: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((bytes) => bytes.toString('base64')).join('.');
}
export function decrypt(value: string, key: string): string {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted credential');
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64'));
  if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !ciphertext)
    throw new Error('Invalid encrypted credential');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
