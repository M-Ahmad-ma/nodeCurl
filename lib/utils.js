import fs, { existsSync } from "fs";
import path from "path";
import { pipeline } from "stream";

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
    }
    process.stdout.write(data);
    return;
  }

  if (flags.noClober && fs.existsSync(flags.output)) return;

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
        else console.log("file timeStamp saved succesfully");
      });
    }
    console.log(timeStamp);
    return writeStream;
  }

  if (flags.output && flags.output !== "-") {
    if (flags.noClober && fs.existsSync(flags.output)) {
      res.resume();
      return null;
    }

    const dir = path.dirname(flags.output);
    fs.mkdirSync(dir, { recursive: true });
    return fs.createWriteStream(flags.output);
  }

  if (isBinary) {
    console.error("binary output can mess up your terminal");
    process.exit(1);
  }

  return process.stdout;
}

export function streamResponse(res, destination) {
  if (!destination) return;

  pipeline(res, destination, (err) => {
    if (err) console.error("Pipeline failed:", err.message);
  });
}

export function bufferResponse(res, flags) {
  let data = "";
  res.setEncoding("utf8");

  res.on("data", (chunk) => {
    data += chunk;
  });

  res.on("end", () => {
    writeOutput(data, flags);
  });
}

export function showHelp(module) {
  if (!module) {
    console.log(`
GENERAL USAGE
  ./index.js [module] [options] <url>

Modules:   
  file   Local files
  ftp    FTP operations
  http   HTTP requests

Examples:
  ./index.js -h
  ./index.js file -h
  ./index.js ftp ftp://host
`);
    return;
  }
  switch (module) {
    case "ftp":
      console.log(`
FTP MODULE

Usage:
  ./index.js ftp [options] ftp://host[/path]

FTP options:
  -u, --user <USER:PASS>     FTP credentials (default: anonymous)

Transfer commands:
  -l, --list-only            List files in a directory
  -I, --head                 Fetch file metadata only (SIZE, MDTM)
  -o, --output <file>        Download remote file to local file
  -T, --upload <file>        Upload local file to remote path
  -a, --append               Append to remote file when uploading

Command control:
  -X, --request <command>    Send raw FTP command (PWD, STAT, LIST, etc.)
  -Q, --quote <command>      Send FTP command(s) before transfer

Connection options:
      --ssl                  Use FTPS (explicit TLS)
      --ssl-req              Require SSL/TLS
  -v, --verbose              Verbose FTP protocol output

Behavior:
  Passive mode is used by default.
  Automatically falls back to ACTIVE mode if passive fails.
  Uploads are checked for write permissions before transfer.

Examples:
  List files:
    ./index.js ftp -l ftp://example.com/pub

  Show file metadata:
    ./index.js ftp -I ftp://example.com/pub/file.txt

  Download a file:
    ./index.js ftp -o local.txt ftp://example.com/pub/file.txt

  Upload a file:
    ./index.js ftp -T local.txt ftp://example.com/pub/file.txt

  Append to a file:
    ./index.js ftp -T local.txt -a ftp://example.com/pub/file.txt

  Send a raw FTP command:
    ./index.js ftp -X PWD ftp://example.com

  Send pre-transfer command:
    ./index.js ftp -Q "PWD" -l ftp://example.com/pub
`);
      break;


    case "file":
      console.log(`
FILE MODULE
Usage: ./index.js file [options] file:///path

Options:
  -H   Show headers
  -T   Upload file
`);
      break;

    case "http":
      console.log(`
HTTP MODULE
Usage: ./index.js http [options] https://url

Options:
  -X METHOD
  -d DATA
`);
      break;

    case "output":
      console.log(`
OUTPUT OPTIONS
  Control where and how the response body is written.

  -O, --remote-name
        Write output to a local file named like the remote file.

  -i
        Include protocol response headers in the output.

  -R, --remote-time
        Preserve the timestamp from the remote file.

      --create-dirs
        Create necessary local directories to store the output.

      --create-file-mode
        Create the output file with default permissions if it does not exist.

      --no-clober
        Do not overwrite existing files.

  -N, --no-buffer
        Disable buffering of the output stream.

      --output-dir <dir>
        Store output files in the specified directory.

EXAMPLES
  ./index.js --output-dir downloads https://example.com/file.txt
  ./index.js -O https://example.com/file.txt
  ./index.js -i -N https://example.com/stream
`);
      break;
    default:
      console.log(`
GENERAL USAGE
./index.js [module] [options] <url>  
   
Modules:
  ftp
  file
  http

Try:
  ./index.js ftp -h
`);
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
