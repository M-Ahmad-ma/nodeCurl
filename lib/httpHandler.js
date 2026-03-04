#!/usr/bin/env node
import http from "http";
import https from "https";
import fs from "fs";
import { URL } from "url";
import { pipeline } from "stream";
import {
  applyAuth,
  bufferResponse,
  getStreamDestination,
  isBinaryResponse,
  mayWait,
  streamResponse,
  loadCookieJar,
  saveCookieJar,
} from "./utils.js";
import { createDnsLookup } from "./dnsHandler.js";
import { createSpeedMonitorStream } from "./monitor.js";

const RETRY_CODES = [408, 429, 500, 502, 503, 504];

function verboseLog(flags, message) {
  if (flags.verbose) {
    process.stderr.write(message + "\n");
  }
}

function verboseRequest(flags, options, body) {
  if (!flags.verbose) return;
  
  verboseLog(flags, `> ${options.method} ${options.path} HTTP/1.1`);
  for (const [key, value] of Object.entries(options.headers)) {
    verboseLog(flags, `> ${key}: ${value}`);
  }
  if (body) {
    verboseLog(flags, `> `);
    verboseLog(flags, body.substring(0, 1024));
  }
}

function verboseResponse(flags, res, body) {
  if (!flags.verbose) return;
  
  verboseLog(flags, `< HTTP/1.1 ${res.statusCode} ${res.statusMessage}`);
  for (const [key, value] of Object.entries(res.headers)) {
    verboseLog(flags, `< ${key}: ${value}`);
  }
  if (body && body.length > 0) {
    verboseLog(flags, `< `);
    verboseLog(flags, body.substring(0, 1024));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeRequest(url, method, flags, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const protocol = parsed.protocol === "https:" ? https : http;

    let headers = applyAuth(flags.headers || {}, flags);
    
    if (flags.userAgent) {
      headers["User-Agent"] = flags.userAgent;
    }
    if (flags.referer) {
      headers["Referer"] = flags.referer;
    }

    let body = null;

    if (flags.upload) {
      body =
        flags.upload === "-"
          ? fs.readFileSync(0)
          : fs.readFileSync(flags.upload);
      headers["Content-Type"] ||= "application/octet-stream";
      headers["Content-Length"] = Buffer.byteLength(body);
    } else if (flags.json) {
      try {
        if (typeof flags.json === "string") {
          JSON.parse(flags.json);
          body = flags.json;
        } else {
          body = JSON.stringify(flags.json);
        }
      } catch (e) {
        body = String(flags.json);
      }
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    } else if (flags.data) {
      if (typeof flags.data === "string") {
        const trimmed = flags.data.trim();
        if (
          (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
          (trimmed.startsWith("[") && trimmed.endsWith("]"))
        ) {
          try {
            JSON.parse(trimmed);
            body = trimmed;
            headers["Content-Type"] = "application/json";
          } catch (e) {
            body = flags.data;
            headers["Content-Type"] ||= "application/x-www-form-urlencoded";
          }
        } else {
          body = flags.data;
          headers["Content-Type"] ||= "application/x-www-form-urlencoded";
        }
      } else {
        body = JSON.stringify(flags.data);
        headers["Content-Type"] = "application/json";
      }
      headers["Content-Length"] = Buffer.byteLength(body);
    }

    if (["GET", "HEAD", "DELETE"].includes(method)) {
      body = null;
      delete headers["Content-Length"];
    }

    if (!headers["Content-Type"] && body && typeof body === "string") {
      const trimmed = body.trim();
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        try {
          JSON.parse(trimmed);
          headers["Content-Type"] = "application/json";
        } catch (e) {
          headers["Content-Type"] = "text/plain";
        }
      } else {
        headers["Content-Type"] = "text/plain";
      }
    }

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        "User-Agent": "curl/8.x-clone",
        Accept: "*/*",
        ...headers,
      },
      lookup: createDnsLookup(flags),
    };

    if (protocol === https) {
      options.agent = new https.Agent({
        rejectUnauthorized: !flags.insecure,
      });
    }

    const cookies = loadCookieJar(flags);
    if (cookies.length > 0) {
      const cookieHeader = cookies
        .filter(c => !c.expireTime || c.expireTime > Date.now())
        .map(c => `${c.name}=${c.value}`)
        .join("; ");
      if (cookieHeader) {
        options.headers["Cookie"] = cookieHeader;
      }
    }

    verboseRequest(flags, options, body);

    const req = protocol.request(options, (res) => {
      if (flags.cookieJar) {
        const setCookies = res.headers["set-cookie"];
        if (setCookies) {
          saveCookieJar(flags.cookieJar, setCookies, parsed.hostname);
        }
      }

      if (flags.verbose) {
        verboseResponse(flags, res, "");
      }

      if (flags.location && [301, 302, 303, 307, 308].includes(res.statusCode)) {
        const maxRedirs = flags.maxRedirs ?? Infinity;
        if (redirectCount >= maxRedirs) {
          return reject(new Error(`Too many redirects (max: ${maxRedirs})`));
        }
        const newUrl = res.headers.location;
        if (newUrl) {
          const redirectUrl = new URL(newUrl, url).toString();
          verboseLog(flags, `> Redirecting to: ${redirectUrl} (${redirectCount + 1}/${maxRedirs === Infinity ? '∞' : maxRedirs})`);
          return resolve(makeRequest(redirectUrl, method, flags, redirectCount + 1));
        }
      }

      if (flags.head || flags.include || method === "HEAD") {
        let out = `HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}\n`;
        for (const [k, v] of Object.entries(res.headers)) {
          out += `${k}: ${v}\n`;
        }
        out += "\n";
        process.stdout.write(out);
        if (flags.head || method === "HEAD") {
          return resolve();
        }
      }

      const isBinary = isBinaryResponse(res);

      if (
        isBinary ||
        flags.output ||
        flags.outputDir ||
        flags.maxFilesize ||
        flags.speedLimit ||
        flags.speedTime
      ) {
        const dest = getStreamDestination(res, flags, parsed, isBinary);
        streamResponse(res, dest, flags);
        res.on("end", resolve);
      } else {
        bufferResponse(res, flags, resolve);
      }
    });

    req.on("error", reject);

    if (flags.timeout) {
      req.setTimeout(flags.timeout * 1000, () => {
        req.destroy(new Error("Request timeout"));
      });
    }

    if (body) {
      if (Buffer.isBuffer(body)) {
        req.write(body);
      } else if (typeof body === "string") {
        req.write(body, "utf8");
      } else {
        req.write(String(body));
      }
    }

    req.end();
  });
}

export function request(url, method = "GET", flags = {}) {
  const maxRetries = flags.retry || 0;
  let lastError;
  let attempt = 0;

  async function attemptRequest() {
    attempt++;
    try {
      return await makeRequest(url, method, flags);
    } catch (err) {
      lastError = err;
      
      const shouldRetry = 
        maxRetries > 0 &&
        attempt <= maxRetries &&
        (RETRY_CODES.includes(err.code) || err.message?.includes("ECONNREFUSED"));
      
      if (shouldRetry) {
        verboseLog(flags, `> Retry ${attempt}/${maxRetries} after error: ${err.message}`);
        await sleep(1000 * attempt);
        return attemptRequest();
      }
      
      throw err;
    }
  }

  return attemptRequest();
}

export async function parallelRequests(urls, flags = {}) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error("--parallel requires multiple URLs");
  }

  const max = flags.parallelMax || urls.length;
  let index = 0;

  await mayWait(flags);
  async function worker() {
    while (true) {
      const urlIndex = index++;
      if (urlIndex >= max || urlIndex >= urls.length) return;
      const url = urls[urlIndex];

      try {
        await request(url, "GET", flags);
      } catch (err) {
        console.error(`Error: ${url} → ${err.message}`);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(max, urls.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
}

export const get = (url, flags) => request(url, "GET", flags);
export const post = (url, flags) => request(url, "POST", flags);
export const put = (url, flags) => request(url, "PUT", flags);
export const patch = (url, flags) => request(url, "PATCH", flags);
export const deleteReq = (url, flags) => request(url, "DELETE", flags);
