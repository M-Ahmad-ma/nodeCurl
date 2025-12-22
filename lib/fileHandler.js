import fs from "fs";
import { writeOutput, expandLocalVars } from "./utils.js";
import { stat as statAsync } from "fs/promises";

export function readLocalFile(url, flags) {
  const filePath = url.replace("file://", "");

  if (!fs.existsSync(filePath)) {
    console.error("File does not exist:", filePath);
    process.exit(1);
  }

  const stat = fs.statSync(filePath);

  if (flags.head) {
    writeOutput(
      `Status: 200 OK\nContent-Length: ${stat.size}\nContent-Type: text/plain\n`,
      flags,
    );
    return;
  }

  if (flags["list-only"]) {
    if (!stat.isDirectory()) {
      console.error("-l works only on directories");
      process.exit(1);
    }
    const items = fs.readdirSync(filePath).join("\n");
    writeOutput(items, flags);
    return;
  }

  let content = fs.readFileSync(filePath);
  writeOutput(content, flags);
}

export function createFile(url, flags) {
  const targetPath = url.replace("file://", "");
  let data;

  if (flags.upload === "-") {
    data = fs.readFileSync(0);
  } else {
    const uploadPath = expandLocalVars(flags.upload);
    if (!fs.existsSync(uploadPath)) {
      console.error("Upload file does not exist:", uploadPath);
      process.exit(1);
    }
    data = fs.readFileSync(uploadPath);
  }

  const mode = flags["create-file-mode"]
    ? parseInt(flags["create-file-mode"], 8)
    : 0o644;

  fs.writeFileSync(targetPath, data, { mode });
  fs.chmodSync(targetPath, mode);
  console.log(`Created file: ${targetPath} (${mode.toString(8)})`);
}

export async function readHeaders(url, flags) {
  const filePath = url.replace("file://", "");
  try {
    const stats = await statAsync(filePath);        
    
    const headers =
      `Status: 200 OK\n` +        
      `Content-Length: ${stats.size}\n` +           
      `Last-Modified: ${stats.mtime.toUTCString()}\n`;   

    // writeOutput(headers, flags);  
    console.log(headers)    
  } catch (err) {  
    console.error("File not found:", filePath);
    process.exit(1);  
  }
}
