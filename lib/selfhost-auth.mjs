// Pure authentication logic for the self-hosted form-login mode.
// Enabled only when SELFHOST_FORM_AUTH=1; the auth API routes return 404
// otherwise so the ChatGPT Sites/Cloudflare build keeps its behavior.
//
// Passwords: PBKDF2-SHA256 versioned hash string
//   pbkdf2-sha256$<iterations>$<salt-b64url>$<digest-b64url>
// Sessions:  HMAC-SHA256 signed token  <payload-b64url>.<signature-b64url>
//   payload = { username, exp } where exp is unix seconds
// Cookie:    __Host-kaoyan_session (HttpOnly, Secure, SameSite=Lax, Path=/)
//
// Uses only Web Crypto (globalThis.crypto.subtle) so the same module runs on
// Node 22 and Cloudflare Workers without importing node:crypto.

export const SESSION_COOKIE_NAME = "__Host-kaoyan_session"
export const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

const PBKDF2_ALGORITHM = "PBKDF2"
const PBKDF2_HASH = "SHA-256"
const PBKDF2_DEFAULT_ITERATIONS = 600_000
const PBKDF2_KEY_LENGTH_BYTES = 32
const PBKDF2_VERSION = "pbkdf2-sha256"
const TOKEN_DELIMITER = "."

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function isFormAuthEnabled() {
  return process.env.SELFHOST_FORM_AUTH === "1"
}

// Read the auth config from the environment. Throws when any value is missing
// so callers can fail closed instead of allowing anonymous access.
export function getAuthConfig() {
  const username = process.env.SELFHOST_AUTH_USERNAME
  const passwordHash = process.env.SELFHOST_AUTH_PASSWORD_HASH
  const sessionSecret = process.env.SELFHOST_SESSION_SECRET
  if (!username || !passwordHash || !sessionSecret) {
    throw new Error(
      "Self-hosted form auth is enabled but SELFHOST_AUTH_USERNAME, SELFHOST_AUTH_PASSWORD_HASH or SELFHOST_SESSION_SECRET is missing.",
    )
  }
  return { username, passwordHash, sessionSecret }
}

export function constantTimeEqual(a, b) {
  const left = toBytes(a)
  const right = toBytes(b)
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i]
  return diff === 0
}

export async function hashPassword(password, iterations = PBKDF2_DEFAULT_ITERATIONS) {
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("password must be a non-empty string")
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const digest = await derivePbkdf2(password, salt, iterations)
  return [PBKDF2_VERSION, iterations, toBase64Url(salt), toBase64Url(digest)].join("$")
}

export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false
  const parts = stored.split("$")
  if (parts.length !== 4) return false
  const [version, iterationsText, saltText, digestText] = parts
  if (version !== PBKDF2_VERSION) return false
  const iterations = Number(iterationsText)
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return false
  let salt
  let expected
  try {
    salt = fromBase64Url(saltText)
    expected = fromBase64Url(digestText)
  } catch {
    return false
  }
  const actual = await derivePbkdf2(password, salt, iterations)
  return constantTimeEqual(actual, expected)
}

export function sessionExpiry(nowSeconds = Math.floor(Date.now() / 1000)) {
  return nowSeconds + SESSION_COOKIE_MAX_AGE_SECONDS
}

export async function signSessionToken(username, secret, exp = sessionExpiry()) {
  if (typeof username !== "string" || username.length === 0) {
    throw new TypeError("username must be a non-empty string")
  }
  if (typeof secret !== "string" || secret.length === 0) {
    throw new TypeError("secret must be a non-empty string")
  }
  if (!Number.isInteger(exp) || exp <= 0) {
    throw new TypeError("exp must be a positive unix-seconds integer")
  }
  const payload = toBase64Url(encoder.encode(JSON.stringify({ username, exp })))
  const signature = await hmacSha256(payload, secret)
  return [payload, toBase64Url(signature)].join(TOKEN_DELIMITER)
}

export async function verifySessionToken(token, secret) {
  if (typeof token !== "string" || typeof secret !== "string" || secret.length === 0) return null
  const dot = token.lastIndexOf(TOKEN_DELIMITER)
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const signatureText = token.slice(dot + 1)
  let signature
  try {
    signature = fromBase64Url(signatureText)
  } catch {
    return null
  }
  const expected = await hmacSha256(payload, secret)
  if (!constantTimeEqual(signature, expected)) return null
  let data
  try {
    data = JSON.parse(decoder.decode(fromBase64Url(payload)))
  } catch {
    return null
  }
  if (typeof data?.username !== "string" || data.username.length === 0) return null
  if (!Number.isInteger(data.exp) || data.exp <= Math.floor(Date.now() / 1000)) return null
  return { username: data.username, exp: data.exp }
}

export function generateSessionSecret() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

export function sessionCookieHeader(token, maxAgeSeconds = SESSION_COOKIE_MAX_AGE_SECONDS) {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export function parseCookieHeader(headerValue) {
  const cookies = {}
  if (typeof headerValue !== "string") return cookies
  for (const part of headerValue.split(";")) {
    const eq = part.indexOf("=")
    if (eq <= 0) continue
    const name = part.slice(0, eq).trim()
    if (name) cookies[name] = part.slice(eq + 1).trim()
  }
  return cookies
}

export function sessionTokenFromHeaders(headers) {
  const cookieHeader = typeof headers.get === "function" ? headers.get("cookie") : headers?.cookie
  return parseCookieHeader(cookieHeader)[SESSION_COOKIE_NAME] ?? null
}

const RESERVED_AUTH_PATHS = new Set([
  "/login",
  "/logout",
  "/api/selfhost-auth/login",
  "/api/selfhost-auth/logout",
  "/api/selfhost-auth/check",
])

// Keep only same-origin relative paths for redirect targets. Returns null for
// anything that could be an open-redirect or an auth-loop target.
export function safeReturnTo(value) {
  if (typeof value !== "string" || value.length === 0) return null
  if (!value.startsWith("/") || value.startsWith("//")) return null
  if (value.includes("\\")) return null
  let url
  try {
    url = new URL(value, "https://app.local")
  } catch {
    return null
  }
  if (url.origin !== "https://app.local") return null
  if (RESERVED_AUTH_PATHS.has(url.pathname)) return null
  return `${url.pathname}${url.search}${url.hash}`
}

async function derivePbkdf2(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    PBKDF2_ALGORITHM,
    false,
    ["deriveBits"],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: PBKDF2_ALGORITHM, hash: PBKDF2_HASH, salt, iterations },
    keyMaterial,
    PBKDF2_KEY_LENGTH_BYTES * 8,
  )
  return new Uint8Array(bits)
}

async function hmacSha256(data, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data))
  return new Uint8Array(signature)
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value
  if (typeof value === "string") return encoder.encode(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  throw new TypeError("expected a string, Uint8Array or ArrayBuffer")
}

function toBase64Url(bytes) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}