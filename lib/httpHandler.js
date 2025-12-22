import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { URL } from "url";
import { pipeline } from "stream";
import { applyAuth } from "./utils.js";
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

  // Prepare body
  if (flags.upload) {
    body = flags.upload === "-" ? fs.readFileSync(0) : fs.readFileSync(flags.upload);
    headers["Content-Type"] ||= "application/octet-stream";
    headers["Content-Length"] ||= Buffer.byteLength(body);
  } else if (flags.data) {
    body = typeof flags.data === "string" ? flags.data : JSON.stringify(flags.data);
    headers["Content-Type"] ||= "application/x-www-form-urlencoded";
    headers["Content-Length"] ||= Buffer.byteLength(body);
  } else if (flags.form) {
    body = new URLSearchParams(flags.form).toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    headers["Content-Length"] = Buffer.byteLength(body);
  } else if (flags.json) {
    body = typeof flags.json === "string" ? flags.json : JSON.stringify(flags.json);
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
      return;
    }

    const contentType = res.headers["content-type"] || "";
    const isBinary = 
      contentType.includes("application/octet-stream") ||
      contentType.includes("image/") ||
      contentType.includes("application/pdf");

    let destination;
    if (flags.outputDir) {
      console.log("output dirs response")
    }
    if (flags.output && flags.output !== "-") {
      const filePath = flags.output;

      if (flags.noClober && fs.existsSync(filePath)) {
        res.resume(); 
        return;
      }

      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      destination = fs.createWriteStream(filePath);
    } else if(isBinary) {
      console.log("binary output can mess up your terminal")  
    } else {   
      destination = process.stdout;
    }

    pipeline(res, destination, (err) => {
      if (err) console.error("Pipeline failed:", err.message);
      else if (!flags.output) console.log(); 
    });
  });

  req.on("error", (err) => {
    console.error("Request Error:", err.message);
    process.exit(1);
  });

  if (flags.timeout) {
    req.setTimeout(flags.timeout * 1000, () => {
      req.destroy();
      console.error(`Timeout after ${flags.timeout} seconds`);
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
