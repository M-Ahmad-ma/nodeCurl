import fs, { existsSync } from "fs";
import path from "path";

export function expandLocalVars(url) {
  return url
    .replace("$(pwd)", process.cwd())
    .replace("${pwd}", process.cwd())
    .replace("$PWD", process.cwd());
}

export function isFileURL(url) {
  return url.startsWith("file://");
}

export function isFtp(url) {
  return url.startsWith("ftp://")
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
      console.log("this is a binary output")
      return;
    } else if (typeof data === "string") {      
      process.stdout.write(data);       
      return;   
    }   
  }    

  const filePath = flags.output;
  const dirName = path.dirname(filePath);

  if (!fs.existsSync(dirName)) {
    fs.mkdirSync(dirName, { recursive: true });
  }


  const mode = flags["create-file-mode"]
    ? parseInt(flags["create-file-mode"], 8)
    : 0o644;


  fs.writeFileSync(filePath, data, { mode });
  fs.chmodSync(filePath, mode);
}

