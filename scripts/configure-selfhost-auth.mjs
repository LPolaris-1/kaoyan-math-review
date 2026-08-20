#!/usr/bin/env node
// Generate auth.env for the self-hosted web-login mode (SELFHOST_FORM_AUTH=1).
//
// The username comes from SELFHOST_AUTH_USERNAME or from stdin; the password is
// always read from stdin without echoing it. Only the PBKDF2-SHA256 hash and a
// random HMAC session secret and SELFHOST_FORM_AUTH=1 (plus the username) are
// written to auth.env. The plaintext password is never stored, printed, or logged.
//
// Target file resolution:
//   1. SELFHOST_AUTH_ENV_FILE, if set
//   2. <dirname of REVIEW_DB_PATH>/auth.env, if REVIEW_DB_PATH is set
//   3. ./auth.env
//
// The file is written atomically (temp file + rename) with mode 0600 on POSIX
// systems; Windows does not expose POSIX permission bits.
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { pathToFileURL } from "node:url"
import { generateSessionSecret, hashPassword } from "../lib/selfhost-auth.mjs"

function resolveTarget() {
  if (process.env.SELFHOST_AUTH_ENV_FILE) return process.env.SELFHOST_AUTH_ENV_FILE
  if (process.env.REVIEW_DB_PATH) {
    return path.join(path.dirname(path.resolve(process.env.REVIEW_DB_PATH)), "auth.env")
  }
  return path.join(process.cwd(), "auth.env")
}

// Strip a single trailing CR so CRLF pipe input (Windows PowerShell) does not
// leak "\r" into the password hash. Deliberately touches only the trailing
// "\r"; any other whitespace in the password is preserved.
export function stripTrailingCarriageReturn(line) {
  return line.endsWith("\r") ? line.slice(0, -1) : line
}

// Read one line from stdin. For pipes nothing is echoed anyway; for a TTY we
// switch to raw mode so typed characters stay invisible, with backspace and
// Ctrl+C handled explicitly.
function silentLine() {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    if (!stdin.isTTY) {
      let buffer = ""
      stdin.setEncoding("utf8")
      const onData = (chunk) => {
        const newline = chunk.indexOf("\n")
        if (newline >= 0) {
          buffer += chunk.slice(0, newline)
          stdin.removeListener("data", onData)
          stdin.removeListener("end", onEnd)
          resolve(stripTrailingCarriageReturn(buffer))
        } else {
          buffer += chunk
        }
      }
      const onEnd = () => {
        stdin.removeListener("data", onData)
        resolve(stripTrailingCarriageReturn(buffer))
      }
      stdin.on("data", onData)
      stdin.on("end", onEnd)
      return
    }
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding("utf8")
    let buffer = ""
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.removeListener("data", onData)
          stdin.setRawMode(false)
          process.stderr.write("\n")
          resolve(buffer)
          return
        }
        if (ch === "\u0003") {
          stdin.removeListener("data", onData)
          stdin.setRawMode(false)
          process.exit(130)
        }
        if (ch === "\u007f" || ch === "\b") {
          buffer = buffer.slice(0, -1)
          continue
        }
        buffer += ch
      }
    }
    stdin.on("data", onData)
    stdin.on("error", reject)
  })
}

function readAllStdin() {
  return new Promise((resolve) => {
    let data = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => {
      data += chunk
    })
    process.stdin.on("end", () => resolve(data))
  })
}

async function collectCredentials() {
  const envUsername = process.env.SELFHOST_AUTH_USERNAME
  if (envUsername) {
    return { username: envUsername, password: await silentLine() }
  }
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const username = await new Promise((resolve) => rl.question("Username: ", resolve))
    rl.close()
    process.stderr.write("Password: ")
    const password = await silentLine()
    return { username, password }
  }
  const [username, password] = (await readAllStdin()).split(/\r?\n/)
  return { username, password }
}

// Core write path, kept importable so tests can exercise it without spawning a
// child process. Validates input, hashes the password, and writes auth.env
// atomically with mode 0600; never persists the plaintext password.
export async function writeAuthEnv(target, username, password) {
  if (!username || !password) {
    throw new Error("Username and password are required.")
  }
  if (username.includes("=") || /[\r\n]/.test(username)) {
    throw new Error("Username must not contain '=' or line breaks.")
  }
  const passwordHash = await hashPassword(password)
  const sessionSecret = generateSessionSecret()
  const content = [
    "SELFHOST_FORM_AUTH=1",
    `SELFHOST_AUTH_USERNAME=${username}`,
    `SELFHOST_AUTH_PASSWORD_HASH=${passwordHash}`,
    `SELFHOST_SESSION_SECRET=${sessionSecret}`,
    "",
  ].join("\n")
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, content, { mode: 0o600 })
  fs.renameSync(tmp, target)
  fs.chmodSync(target, 0o600)
  return target
}

async function main() {
  const target = resolveTarget()
  const { username, password } = await collectCredentials()
  await writeAuthEnv(target, username, password)
  console.log(`[configure-selfhost-auth] Wrote ${target} (PBKDF2-SHA256 hash + HMAC session secret).`)
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  main().catch((error) => {
    console.error(`[configure-selfhost-auth] ${error.message}`)
    process.exit(1)
  })
}