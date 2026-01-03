import { Client } from "basic-ftp";
import fs from "fs";
import path from "path";
import { testWritable } from "./utils.js";

export async function ftpList(url, flags = {}) {
  if (!url) throw new Error("No FTP URL provided");

  const cleanUrl = url.replace(/^ftp:\/\//, "").replace(/\/$/, "");
  const parts = cleanUrl.split("/");
  const hostname = parts.shift();
  const remotePath = parts.join("/") || ".";

  let [username, password] = (flags.user || "anonymous:anonymous").split(":");
  if (username === "anonymous" && password === "anonymous") {
    password = "anonymous@example.com";
  }

  const client = new Client();
  client.ftp.verbose = flags.verbose || false;

  let triedActive = false;

  const connectAndTransfer = async (useActive = false) => {
    client.ftp.active = !!useActive;
    console.log(useActive ? "Trying ACTIVE mode..." : "Using PASSIVE mode...");

    try {
      await client.access({
        host: hostname,
        user: username,
        password,
        secure: flags.ssl || flags.sslReq || false,
      });

      if (flags.quote?.length) {
        for (const cmd of flags.quote) {
          console.log(`Sending QUOTE command: ${cmd}`);
          const res = await client.send(cmd);
          if (res?.message) console.log(res.message);
        }
      }

      if (flags.method) {
        console.log(`Sending FTP command via -X: ${flags.method}`);
        const res = await client.send(flags.method);
        if (res?.message) console.log(res.message);
        return;
      }

      if (flags.head) {
        const size = await client.size(remotePath);
        const modified = await client.lastMod(remotePath);

        console.log("File metadata:");
        console.log("Path:", remotePath);
        console.log("Size:", size, "bytes");
        console.log("Last modified:", modified);
        return;
      }

      if (flags.l || flags.listOnly) {
        const list = await client.list(remotePath);
        console.log(`Listing files in ${remotePath}:`);
        list.forEach((file) => {
          console.log(`${file.name}\t${file.size}\t${file.date}`);
        });
        return;
      }

      if (flags.o || flags.output) {
        const localFile = path.resolve(flags.o || flags.output);
        console.log(`Downloading ${remotePath} -> ${localFile}`);
        await client.downloadTo(localFile, remotePath);
        console.log("Download complete.");
        return;
      }

      if (flags.T || flags.upload) {
        const localFile = flags.T || flags.upload;

        if (!fs.existsSync(localFile)) {
          throw new Error(`Local file does not exist: ${localFile}`);
        }

        const writable = await testWritable(client, remotePath);
        if (!writable) {
          console.error(
            `FTP Error: target path "${remotePath}" is not writable.`,
          );
          return;
        }

        if (flags.a || flags.append) {
          console.log(`Appending ${localFile} -> ${remotePath}`);
          await client.appendFrom(localFile, remotePath);
        } else {
          console.log(`Uploading ${localFile} -> ${remotePath}`);
          await client.uploadFrom(localFile, remotePath);
        }

        console.log("Upload complete.");
        return;
      }

      console.log(`Connected to FTP server: ${hostname}`);
      console.log(`Remote path: ${remotePath}`);
    } catch (err) {
      if (!triedActive && !useActive) {
        triedActive = true;
        client.close();
        console.warn("PASSIVE mode failed, falling back to ACTIVE mode...");
        await connectAndTransfer(true);
      } else {
        console.error("FTP Error:", err.message);
      }
    } finally {
      client.close();
    }
  };

  await connectAndTransfer();
}
