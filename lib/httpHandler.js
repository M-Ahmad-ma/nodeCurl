import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { URL } from "url";
import { pipeline } from "stream";
import {
  applyAuth,
  bufferResponse,
  getStreamDestination,
  isBinaryResponse,
  streamResponse,
  writeOutput,
} from "./utils.js";
import { createDnsLookup } from "./dnsHandler.js";

export function request(url, method, flags) {
  const parsed = new URL(url);
  const protocol = parsed.protocol === "https:" ? https : http;

  const headers = applyAuth(flags.headers || {}, flags);

  if (!method) {
    if (flags.POST) method = "POST";
    else if (flags.PUT) method = "PUT";
    else if (flags.DELETE) method = "DELETE";
    else if (flags.upload) method = "PUT";
    else if (flags.data || flags.json || flags.form) method = "POST";
    else method = "GET";
  }

  let body = null;

  if (flags.upload) {
    body =
      flags.upload === "-" ? fs.readFileSync(0) : fs.readFileSync(flags.upload);
    headers["Content-Type"] ||= "application/octet-stream";
    headers["Content-Length"] ||= Buffer.byteLength(body);
  } else if (flags.data) {
    const contentType = headers["Content-Type"] || headers["content-type"];
    
    if (contentType && contentType.includes("application/json")) {
      if (typeof flags.data === "string") {
        try {
          body = flags.data;
        } catch (e) {
          // If it's not valid JSON, send as-is
          body = flags.data;
        }
      } else {
        // If it's already an object, stringify it
        body = JSON.stringify(flags.data);
      }
    } else {
      // For non-JSON content types, use as-is
      body = typeof flags.data === "string" ? flags.data : JSON.stringify(flags.data);
      headers["Content-Type"] ||= "application/x-www-form-urlencoded";
    }
    headers["Content-Length"] = Buffer.byteLength(body);
  } else if (flags.form) {
    body = new URLSearchParams(flags.form).toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    headers["Content-Length"] = Buffer.byteLength(body);
  } else if (flags.json) {
    body =
      typeof flags.json === "string" ? flags.json : JSON.stringify(flags.json);
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(body);
  }

  if (["GET", "HEAD", "DELETE"].includes(method.toUpperCase())) {
    body = null;
    delete headers["Content-Length"];
  }

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (protocol === https ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: method.toUpperCase(),
    headers: {
      "User-Agent": "curl/8.5.0",
      Accept: "*/*",
      ...headers,
    },
    lookup: createDnsLookup(flags),
  };

  const req = protocol.request(options, (res) => {
    const isHead = flags.head || method.toUpperCase() === "HEAD";

    if (isHead) {
      let headerText = `HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}\n`;

      for (const [k, v] of Object.entries(res.headers)) {
        headerText += `${k}: ${v}\n`;
      }

      process.stdout.write(headerText);
      process.exit(0);
    }

    const isBinary = isBinaryResponse(res);

    if (isBinary || flags.output || flags.outputDir) {
      const destination = getStreamDestination(res, flags, parsed, isBinary);
      streamResponse(res, destination);
    } else {
      bufferResponse(res, flags);
    }
  });

  req.on("error", (err) => {
    console.error("Request Error:", err.message);
    process.exit(1);
  });

  if (flags.maxTimeout) {
    console.log(flags.maxTimeout);
    req.setTimeout(flags.maxTimeout * 1000, () => {
      req.destroy();
      console.error(`Timeout after ${flags.maxTimeout} seconds`);
      process.exit(1);
    });
  } else if (flags.timeout) {
    req.setTimeout(flags.timeout * 1000, () => {
      req.destroy();
      console.error(`Connection timeout after ${flags.timeout} seconds`);
      process.exit(1);
    });
  }

  if (body) req.write(body);
  req.end();
}

export const get = (url, flags) => request(url, "GET", flags);
export const post = (url, flags) => request(url, "POST", flags);
export const put = (url, flags) => request(url, "PUT", flags);
export const patch = (url, flags) => request(url, "PATCH", flags);
export const deleteReq = (url, flags) => request(url, "DELETE", flags);
