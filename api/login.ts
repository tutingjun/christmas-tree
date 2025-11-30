import { sql } from "@vercel/postgres";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const SESSION_COOKIE = "tree_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const ALLOWED_USERNAME = "Guandacol";
const AUTH_SECRET =
  process.env.AUTH_SECRET || "development-secret-set-AUTH_SECRET";

function sign(username: string) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(username).digest("hex");
}

function readSession(req: VercelRequest) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((entry) => {
      const [key, ...val] = entry.trim().split("=");
      return [decodeURIComponent(key), decodeURIComponent(val.join("="))];
    })
  );

  const raw = cookies[SESSION_COOKIE];
  if (!raw || typeof raw !== "string") return null;
  const [username, providedSig] = raw.split(".");
  if (!username || !providedSig) return null;

  const expectedSig = sign(username);
  if (providedSig.length !== expectedSig.length) return null;
  return crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig))
    ? username
    : null;
}

function setSessionCookie(res: VercelResponse, username: string) {
  const value = `${username}.${sign(username)}`;
  const cookie = [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    "Secure",
  ].join("; ");
  res.setHeader("Set-Cookie", cookie);
}

async function readBody(req: VercelRequest) {
  if (req.body) return req.body as any;
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method === "GET") {
    const username = readSession(req);
    if (!username) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.status(200).json({ authenticated: true, username });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  try {
    const body = await readBody(req);
    const { username, password } = body || {};
    if (!username || !password) {
      res.status(400).json({ error: "username and password are required" });
      return;
    }

    if (username !== ALLOWED_USERNAME) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const { rows } = await sql<{
      password_hash: string | null;
    }>`SELECT password_hash FROM users WHERE name = ${username} LIMIT 1`;
    if (!rows.length) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const storedPassword = rows[0].password_hash;
    const valid =
      typeof storedPassword === "string" &&
      storedPassword.length > 0 &&
      (await bcrypt.compare(password, storedPassword));
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    setSessionCookie(res, username);
    res.status(200).json({ authenticated: true, username });
  } catch (err) {
    console.error("Login error", err);
    res.status(500).json({ error: "Unexpected error" });
  }
}
