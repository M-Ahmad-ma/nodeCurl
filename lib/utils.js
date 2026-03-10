import fs, { existsSync } from "fs";
import path from "path";
import { pipeline } from "stream";
import { Transform, Readable } from "stream";
import { createSpeedMonitorStream } from "./monitor.js";

export function expandLocalVars(url) {
  if (!url) return url;
  return url
    .replace("$(pwd)", process.cwd())
    .replace("${pwd}", process.cwd())
    .replace("$PWD", process.cwd());
}

export function isFileURL(url) {
  return url.startsWith("file://");
}

export function isFtp(url) {
  return url.startsWith("ftp://");
}

export function applyAuth(headers = {}, flags) {
  if (flags.user) {
    const [u, p] = flags.user.split(":");
    headers["Authorization"] =
      "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
  }
  if (flags.bearer) headers["Authorization"] = `Bearer ${flags.bearer}`;
  if (flags.apikey) headers["Authorization"] = `Api-Key ${flags.apikey}`;
  return headers;
}

export function writeOutput(data, flags) {
  if (!flags.output) {
    if (Buffer.isBuffer(data)) {
      process.stderr.write("Binary data detected. Use -o or --output-dir.\n");
      process.exit(1);
    } else if (flags.rateLimit) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");

      const readableStream = Readable.from(buf);

      const rate = Number(flags.rateLimit);

      const rateLimitStream = createRateLimitStream(rate);

      pipeline(readableStream, rateLimitStream, process.stdout, (err) => {
        if (err && err.code !== "EPIPE") {
          console.error("Pipeline failed:", err.message);
        }
      });

      return;
    }

    process.stdout.write(data);
    return;
  }

  if (flags.noClobber && fs.existsSync(flags.output)) return;

  const dir = path.dirname(flags.output);
  fs.mkdirSync(dir, { recursive: true });

  const mode = flags["create-file-mode"]
    ? parseInt(flags["create-file-mode"], 8)
    : 0o644;

  fs.writeFileSync(flags.output, data, { mode });
  fs.chmodSync(flags.output, mode);
}

export function isBinaryResponse(res) {
  const ct = res.headers["content-type"] || "";
  return (
    ct.includes("application/octet-stream") ||
    ct.includes("image/") ||
    ct.includes("application/pdf")
  );
}

export function getStreamDestination(res, flags, parsed, isBinary) {
  if (flags.outputDir && flags.remoteName) {
    const filename = path.basename(parsed.pathname) || "index.html";
    const fullPath = path.join(flags.outputDir, filename);

    fs.mkdirSync(flags.outputDir, { recursive: true });
    return fs.createWriteStream(fullPath);
  }

  // -O -R set remote time stamp to the file
  var filename;
  if (flags.remoteName && !flags.preserveTimeStamp) {
    filename = path.basename(parsed.pathname);
    const writeStream = fs.createWriteStream(filename);

    try {
      streamResponse(res, writeStream);
    } catch (err) {
      console.error("Failed to stream response to file:", err);
      process.exit(1);
    }

    return writeStream;
  } else if (flags.remoteName && flags.preserveTimeStamp) {
    filename = path.basename(parsed.pathname);
    const timeStamp = res.headers["last-modified"] || res.headers["date"];

    const writeStream = fs.createWriteStream(filename);

    try {
      streamResponse(res, writeStream);
    } catch (err) {
      console.error("Failed to stream response to file:", err);
      process.exit(1);
    }

    if (timeStamp) {
      const date = new Date(timeStamp);
      fs.utimes(filename, date, date, (err) => {
        if (err)
          console.error(
            `Failed to update the timestamp for ${timeStamp}:`,
            err,
          );
      });
    }
    return writeStream;
  }

  if (flags.output && flags.output !== "-") {
    if (flags.noClobber && fs.existsSync(flags.output)) {
      res.resume();
      return null;
    }

    const dir = path.dirname(flags.output);
    fs.mkdirSync(dir, { recursive: true });
    return fs.createWriteStream(flags.output);
  }

  if (flags.maxFilesize) {
    let downloaded = 0;
    res.on("data", (chunk) => {
      downloaded += chunk.length;

      if (flags.maxFilesize && downloaded > flags.maxFilesize) {
        res.removeAllListeners("data");
        res.destroy(new Error("Maximum file size exceeded"));
        return;
      }
    });
  }

  if (isBinary && !flags.output) {
    console.error(
      "binary output can mess up your terminal use -o <FILE> to output to a file",
    );
    return;
  }

  return process.stdout;
}

export function streamResponse(res, destination, flags = {}) {
  if (!destination) return;

  const streams = [res];

  if (flags.rateLimit) {
    streams.push(createRateLimitStream(flags.rateLimit));
  }

  if (flags.speedLimit && flags.speedTime) {
    streams.push(createSpeedMonitorStream(flags.speedLimit, flags.speedTime));
  }

  streams.push(destination);

  pipeline(...streams, (err) => {
    if (err) console.error("Pipeline failed:", err.message);
  });
}

export function bufferResponse(res, flags, resolve) {
  let stream = res;
  if (flags.speedLimit && flags.speedTime) {
    stream = res.pipe(
      createSpeedMonitorStream(flags.speedLimit, flags.speedTime),
    );
  }

  let data = "";
  stream.setEncoding("utf8");

  stream.on("data", (chunk) => {
    data += chunk;
  });

  stream.on("end", () => {
    writeOutput(data, flags);
    if (resolve) resolve();
  });

  stream.on("error", (err) => {
    console.error("Transfer aborted:", err.message);
    process.exit(28); // Exit code 28: Operation timeout
  });
}

export function showHelp(module) {
  const synopsis = `Usage: curlie [options] <url>
       curlie ftp://<host>/<path>
       curlie file://<path>`;

  const examples = `Examples:
  curlie -k https://example.com
  curlie -o file.html https://example.com/file
  curlie -L https://example.com/redirect
  curlie -d "name=value" https://example.com/post
  curlie -X POST -d '{"json":"data"}' https://api.example.com
  curlie -c cookies.txt -b cookies.txt https://example.com
  curlie --resolve example.com:443:127.0.0.1 https://example.com`;

  if (!module) {
    console.log(synopsis);
    console.log(`
Options:
  -k, --insecure           Allow insecure server connections (SSL)
  -L, --location          Follow HTTP redirects
  -O, --remote-name       Write output using remote filename
  -o, --output <file>    Write to file
  -T, --upload <file>    Upload file
  -d, --data <data>       HTTP POST data
  -G, --get               Send GET request (default)
  -X, --request <cmd>    HTTP request method
  -H, --header <header>  Add request header
  -A, --user-agent <ua>  Set User-Agent
  -e, --referer <URL>    Set Referer
  -b, --cookie <data>    Send cookies (string or file)
  -c, --cookie-jar <file> Save cookies to file
  -i, --include          Include response headers
  -I, --head             Fetch headers only
  -v, --verbose          Verbose mode
  -u, --user <user:pass> HTTP authentication
  -4, --ipv4             Resolve to IPv4 only
  -6, --ipv6             Resolve to IPv6 only
  --limit-rate <speed>    Limit download speed (e.g. 1M, 100K)
  --max-time <sec>        Maximum time for transfer
  --connect-timeout <sec> Connection timeout
  --retry <num>          Retry on transient errors
  --resolve <host:port:ip> Custom DNS resolve
  --dns-servers <addrs>  Custom DNS servers
  --doh-url <url>        DNS-over-HTTPS
  --max-redirs <num>     Max redirects to follow
  -Z, --parallel <urls>   Parallel downloads
  --parallel-max <num>    Max parallel connections

FTP Options:
  -l, --list-only        List directory
  -a, --append           Append to file
  -Q, --quote <cmd>      Send FTP command

${examples}
`);
    return;
  }

  switch (module) {
    case "ftp":
      console.log(`Usage: curlie ftp [options] ftp://<host>/<path>

Options:
  -u, --user <user:password>  Authentication
  -l, --list-only              List directory contents
  -I, --head                   Get file metadata only
  -o, --output <file>         Download to local file
  -T, --upload <file>         Upload local file
  -a, --append                Append to remote file
  -X, --request <command>     Raw FTP command
  -Q, --quote <command>       Command before transfer
  --ssl                         Use TLS/FTPS
  -v, --verbose               Show protocol details

Examples:
  curlie -l ftp://ftp.example.com/
  curlie -o file.txt ftp://ftp.example.com/file.txt
  curlie -T local.txt ftp://ftp.example.com/upload/`);
      break;

    case "http":
      console.log(`Usage: curlie [options] <url>

Options:
  -X, --request <method>    HTTP method (GET, POST, PUT, DELETE, etc)
  -d, --data <data>         POST data
  --json <json>             JSON data (sets Content-Type: application/json)
  -H, --header <header>     Add custom header (Header: Value)
  -A, --user-agent <name>   User-Agent string
  -e, --referer <URL>       Referer URL
  -b, --cookie <data>       Cookie string or @filename
  -c, --cookie-jar <file>   Save cookies to file
  -i, --include             Include response headers
  -v, --verbose             Show request/response details
  -k, --insecure            Allow insecure SSL
  -L, --location            Follow redirects
  --max-redirs <num>        Max redirects
  --retry <num>             Retry on error
  --limit-rate <speed>      Limit speed

Examples:
  curlie https://example.com
  curlie -X POST -d "name=test" https://api.example.com
  curlie -H "Authorization: Bearer token" https://api.example.com
  curlie -L https://example.com/redirect
  curlie -c cookies.txt -b cookies.txt https://example.com`);
      break;

    case "file":
      console.log(`Usage: curlie file://<path>

Options:
  -H, --head     Show file info (size, modified date)
  -T, --upload   Write to local file

Examples:
  curlie file:///home/user/test.txt
  curlie -H file:///home/user/test.txt
  curlie -T source.txt file:///dest.txt`);
      break;

    case "output":
      console.log(`Output Options:
  -o, --output <file>        Write to specific file
  -O, --remote-name          Write using remote filename
  --output-dir <dir>         Output directory
  -i, --include              Include response headers
  -I, --head                 Headers only
  -R, --remote-time          Preserve remote timestamp
  --no-clobber               Don't overwrite files
  -N, --no-buffer            No buffering
  --create-dirs              Create directories
  --create-file-mode <mode>  File permissions

Examples:
  curlie -o page.html https://example.com
  curlie -O https://example.com/file.txt
  curlie --output-dir ./downloads https://example.com/`);
      break;

    case "connection":
      console.log(`Connection Options:
  --limit-rate <speed>       Speed limit (e.g. 1M, 100K, 1024)
  --max-time <seconds>        Total timeout
  --connect-timeout <seconds> Connection timeout
  -Y, --speed-limit <speed>  Abort if too slow
  -y, --speed-time <seconds>  Slow period before abort
  --max-filesize <bytes>     Max response size
  -Z, --parallel <urls>      Parallel downloads
  --parallel-max <num>       Max parallel
  --retry <num>              Retry count
  --retry-delay <seconds>    Delay between retries

Examples:
  curlie --limit-rate 1M https://example.com/file
  curlie --max-time 60 https://example.com
  curlie -Z url1 url2 url3
  curlie --retry 3 https://unreliable.example.com`);
      break;

    case "dns":
      console.log(`DNS Options:
  --resolve <host:port:addr>  Custom address for host:port
  --dns-servers <addrs>       DNS servers (comma-separated)
  --doh-url <url>              DNS-over-HTTPS URL
  -4, --ipv4                   IPv4 only
  -6, --ipv6                   IPv6 only

Examples:
  curlie --resolve example.com:443:127.0.0.1 https://example.com
  curlie --dns-servers 1.1.1.1,8.8.8.8 https://example.com
  curlie --doh-url https://dns.google/resolve https://example.com
  curlie --ipv4 https://example.com`);
      break;

    default:
      console.log(synopsis);
      console.log(`\nTry 'curlie -h' for more options`);
  }

  process.exit(0);
}

export const testWritable = async (client, remotePath) => {
  const tmpFile = remotePath + ".tmp_check";
  try {
    await client.uploadFrom(Buffer.from("test"), tmpFile);
    await client.remove(tmpFile);
    return true;
  } catch {
    return false;
  }
};

export function createRateLimitStream(bytesPerSecond) {
  if (typeof bytesPerSecond !== "number" || bytesPerSecond <= 0) {
    // Return a passthrough transform stream if rate limiting is invalid
    return new Transform({
      transform(chunk, encoding, callback) {
        callback(null, chunk);
      },
    });
    // console.log("this is a not a number console");
  }

  // console.log("this is  a number console");
  const interval = 1000;
  let lastTime = Date.now();
  let bytesSent = 0;

  return new Transform({
    transform(chunk, encoding, callback) {
      const now = Date.now();
      const elapsed = now - lastTime;

      if (elapsed >= interval) {
        bytesSent = 0;
        lastTime = now;
        this.push(chunk);
        callback();
        return;
      }

      const remainingTime = interval - elapsed;
      const allowedBytes = Math.floor(
        (bytesPerSecond * remainingTime) / interval,
      );

      if (bytesSent + chunk.length <= allowedBytes) {
        bytesSent += chunk.length;
        this.push(chunk);
        callback();
      } else {
        const bytesToWait = bytesSent + chunk.length - allowedBytes;
        const waitTime = (bytesToWait / bytesPerSecond) * 1000;

        setTimeout(() => {
          bytesSent = chunk.length;
          lastTime = Date.now();
          this.push(chunk);
          callback();
        }, waitTime);
      }
    },
  });
}

function wait(ms) {
  // console.log(Date.now(), "waiting", ms, "ms");
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mayWait(flags) {
  if (!flags.parallelImmediate) {
    await wait(100);
  }
}

export function loadCookieJar(flags) {
  const cookies = [];
  
  if (flags.cookie) {
    if (flags.cookie.includes("=")) {
      const [name, ...valueParts] = flags.cookie.split("=");
      cookies.push({
        name: name.trim(),
        value: valueParts.join("=").trim(),
        domain: "",
        path: "/",
        expireTime: null,
      });
    } else if (fs.existsSync(flags.cookie)) {
      const content = fs.readFileSync(flags.cookie, "utf8");
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const parts = trimmed.split("\t");
        if (parts.length >= 7) {
          cookies.push({
            domain: parts[0],
            flag: parts[1] === "TRUE",
            path: parts[2],
            secure: parts[3] === "TRUE",
            expireTime: parseInt(parts[4]) * 1000,
            name: parts[5],
            value: parts[6],
          });
        }
      }
    }
  }
  
  return cookies;
}

export function saveCookieJar(jarPath, setCookies, hostname) {
  const existing = new Map();
  
  if (fs.existsSync(jarPath)) {
    const content = fs.readFileSync(jarPath, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const parts = trimmed.split("\t");
      if (parts.length >= 7) {
        const key = `${parts[0]}|${parts[5]}`;
        existing.set(key, {
          domain: parts[0],
          flag: parts[1] === "TRUE",
          path: parts[2],
          secure: parts[3] === "TRUE",
          expireTime: parseInt(parts[4]) * 1000,
          name: parts[5],
          value: parts[6],
        });
      }
    }
  }
  
  const now = Date.now();
  const oneYear = now + 365 * 24 * 60 * 60 * 1000;
  
  for (const cookieStr of setCookies) {
    const parts = cookieStr.split(";");
    const [nameValue, ...attrs] = parts;
    const [name, ...valueParts] = nameValue.split("=");
    const value = valueParts.join("=");
    
    let domain = hostname;
    let path = "/";
    let secure = false;
    let expireTime = null;
    
    for (const attr of attrs) {
      const [key, val] = attr.trim().split("=");
      const lowerKey = key.toLowerCase();
      if (lowerKey === "domain") {
        domain = val || hostname;
      } else if (lowerKey === "path") {
        path = val || "/";
      } else if (lowerKey === "secure") {
        secure = true;
      } else if (lowerKey === "expires") {
        expireTime = new Date(val).getTime() / 1000;
      }
    }
    
    if (!expireTime) {
      expireTime = Math.floor(oneYear / 1000);
    }
    
    const key = `${domain}|${name}`;
    existing.set(key, {
      domain,
      flag: domain.startsWith("."),
      path,
      secure,
      expireTime: expireTime * 1000,
      name,
      value,
    });
  }
  
  let output = "# Netscape HTTP Cookie File\n";
  output += "# This file was generated by curlie\n\n";
  
  for (const cookie of existing.values()) {
    const flag = cookie.flag ? "TRUE" : "FALSE";
    const secure = cookie.secure ? "TRUE" : "FALSE";
    const expire = Math.floor((cookie.expireTime || oneYear) / 1000);
    output += `${cookie.domain}\t${flag}\t${cookie.path}\t${secure}\t${expire}\t${cookie.name}\t${cookie.value}\n`;
  }
  
  fs.writeFileSync(jarPath, output);
}
