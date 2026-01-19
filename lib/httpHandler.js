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
} from "./utils.js";
import { createDnsLookup } from "./dnsHandler.js";
import { createSpeedMonitorStream } from "./monitor.js";

export function request(url, method = "GET", flags = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const protocol = parsed.protocol === "https:" ? https : http;

    const headers = applyAuth(flags.headers || {}, flags);
    let body = null;

    // ---- body handling ----
    if (flags.upload) {
      // File upload
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
          body = flags.json; // Use the string directly
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

    if (headers["Content-Type"]) {
    } else if (body && typeof body === "string") {
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

    const req = protocol.request(options, (res) => {
      // ---- HEAD handling ----
      if (flags.head || method === "HEAD") {
        let out = `HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}\n`;
        for (const [k, v] of Object.entries(res.headers)) {
          out += `${k}: ${v}\n`;
        }
        process.stdout.write(out);
        return resolve();
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

export async function parallelRequests(urls, flags = {}) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error("--parallel requires multiple URLs");
  }

  const max = flags.parallelMax || urls.length;
  const results = [];
  let index = 0;

  await mayWait(flags);
  async function worker() {
    while (index <= max) {
      const urlIndex = index++;
      const url = urls[urlIndex];

      if (urlIndex >= max) return;

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
