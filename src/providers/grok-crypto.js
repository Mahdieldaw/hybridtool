/**
 *`src/providers/grok-crypto.js`  
 * HTOS Grok Crypto Module
 * - secp256k1 key generation and challenge signing
 * - Uses @noble/secp256k1 (pure JS, no DOM dependencies)
 * 
 * Build-phase safe: runs in Service Worker
 */

import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate cryptographically secure random bytes
 */
function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Base64 encode Uint8Array
 */
function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Base64 decode to Uint8Array
 */
function base64ToBytes(base64) {
  const binary = atob(String(base64 || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert bytes to hex string
 */
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to bytes
 */
function hexToBytes(hex) {
  const clean = String(hex || '').replace(/[^0-9a-f]/gi, '');
  if (clean.length % 2) throw new Error('Invalid hex');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ═══════════════════════════════════════════════════════════════════════════
// KEY GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate secp256k1 keypair for Grok authentication
 * 
 * @returns {{ privateKey: string, userPublicKey: number[] }}
 *   - privateKey: Base64-encoded 32-byte private key
 *   - userPublicKey: Array of bytes (compressed public key, 33 bytes)
 */
export function generateKeys() {
  // Generate 32 random bytes for private key
  const privateKeyBytes = randomBytes(32);
  
  // Get compressed public key (33 bytes, starts with 02 or 03)
  const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, true);
  
  // Encode private key as base64 (matching Python's xor/b64encode pattern)
  // Python: t = ''.join(chr(e[n]) for n in range(len(e))); b64encode(t.encode('latin-1'))
  const privateKeyB64 = bytesToBase64(privateKeyBytes);
  
  return {
    privateKey: privateKeyB64,
    userPublicKey: Array.from(publicKeyBytes),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CHALLENGE SIGNING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sign a challenge with the private key
 * 
 * @param {Uint8Array} challengeData - Raw challenge bytes from server
 * @param {string} privateKeyB64 - Base64-encoded private key
 * @returns {Promise<{ challenge: string, signature: string }>}
 *   - challenge: Base64-encoded challenge data
 *   - signature: Base64-encoded 64-byte compact signature
 */
export async function signChallenge(challengeData, privateKeyB64) {
  // Decode private key
  const privateKeyBytes = base64ToBytes(privateKeyB64);
  
  // Hash the challenge data
  const messageHash = sha256(challengeData);
  
  // Sign using secp256k1 (returns Signature object)
  const signature = await secp256k1.signAsync(messageHash, privateKeyBytes);
  
  // Get compact signature (64 bytes: r || s)
  const sigBytes = signature.toCompactRawBytes();
  
  return {
    challenge: bytesToBase64(challengeData),
    signature: bytesToBase64(sigBytes.slice(0, 64)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS (additional utilities for signature module)
// ═══════════════════════════════════════════════════════════════════════════

export { 
  randomBytes, 
  bytesToBase64, 
  base64ToBytes, 
  bytesToHex, 
  hexToBytes,
  sha256 
};
