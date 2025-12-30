#!/usr/bin/env node
import { parseFlags } from "../lib/flags.js";
import { ftpList } from "../lib/ftpHandler.js";
import { expandLocalVars, isFileURL, isFtp, showHelp } from "../lib/utils.js";
import { readLocalFile, createFile, readHeaders } from "../lib/fileHandler.js";
import { request } from "../lib/httpHandler.js";
// import { outPut } from "../lib/outputHandler.js";

const args = process.argv.slice(2);
const flags = parseFlags(args);
const nonFlagArgs = args.filter((arg) => !arg.startsWith("-"));
const module = nonFlagArgs[0];

if (flags.help) {
  showHelp(module);
  process.exit(0);
}

let url = args.find(
  (arg) =>
    arg.startsWith("http://") ||
    arg.startsWith("https://") ||
    arg.startsWith("file://") ||
    arg.startsWith("ftp://"),
);

if (!url) {
  console.log("Error: Usage: ./index.js [options] <url>");
  process.exit(1);
}

url = expandLocalVars(url);

if (flags.user === undefined) flags.user = "anonymous:anonymous";

const main = async () => {
  if (isFtp(url)) {
    await ftpList(url, flags);
    return;
  }

  if (isFileURL(url)) {
    if (flags.upload) {
      createFile(url, flags);
    } else if (flags.head) {
      await readHeaders(url, flags);
    } else {
      readLocalFile(url, flags);
    }
    process.exit(0);
  }

  let method = flags.method || (flags.upload ? "PUT" : "GET");
  request(url, method, flags);
};

await main();
