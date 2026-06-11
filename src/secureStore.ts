import crypto from 'crypto';
import { execSync } from 'child_process';
import os from 'os';

const SALT = 'claude-switch-super-secret-salt-2026';

/**
 * Attempts to retrieve a unique identifier for the current machine/user
 * to bind the encryption key to this specific computer.
 */
function getMachineFingerprint(): string {
  const parts: string[] = [os.hostname(), os.userInfo().username, os.homedir()];

  try {
    if (process.platform === 'win32') {
      const out = execSync('reg query HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const match = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
      if (match && match[1]) {
        parts.push(match[1]);
      }
    } else if (process.platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const match = out.match(/"IOPlatformUUID"\s+=\s+"([^"]+)"/i);
      if (match && match[1]) {
        parts.push(match[1]);
      }
    } else {
      // Linux
      try {
        const fs = require('fs');
        if (fs.existsSync('/etc/machine-id')) {
          parts.push(fs.readFileSync('/etc/machine-id', 'utf8').trim());
        } else if (fs.existsSync('/var/lib/dbus/machine-id')) {
          parts.push(fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim());
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // Fall back to hostname, user info, and home directory if command fails (e.g. permission restriction)
  }

  return parts.join('|');
}

/**
 * Derives a 256-bit encryption key using PBKDF2 with the machine fingerprint.
 */
let cachedKey: Buffer | null = null;
function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fingerprint = getMachineFingerprint();
  cachedKey = crypto.pbkdf2Sync(fingerprint, SALT, 10000, 32, 'sha256');
  return cachedKey;
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Output format: iv_hex:auth_tag_hex:ciphertext_hex
 */
export function encrypt(plaintext: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${encrypted}`;
  } catch (err: any) {
    throw new Error(`Encryption failed: ${err.message}`);
  }
}

/**
 * Decrypts ciphertext using AES-256-GCM.
 */
export function decrypt(ciphertextWithIv: string): string {
  try {
    const parts = ciphertextWithIv.split(':');
    if (parts.length !== 3) {
      // If the format is not encrypted (e.g. legacy key or exported in plaintext), return as-is
      return ciphertextWithIv;
    }

    const [ivHex, tagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err: any) {
    // If decryption fails, it might be a legacy plaintext key.
    // Try to return it directly if it looks like a Claude API key, otherwise rethrow.
    if (ciphertextWithIv.startsWith('sk-ant-')) {
      return ciphertextWithIv;
    }
    throw new Error(`Decryption failed (are you on a different machine?): ${err.message}`);
  }
}
