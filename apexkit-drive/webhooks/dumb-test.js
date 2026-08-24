export const __fileMetadata__ = {
  "id": 82,
  "name": "dumb-test",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};
import { Hono } from "https://esm.sh/hono";
import { generateFilePreview } from "@/custom/media-preview";

const app = new Hono();
app.post("/", async (c) => {
  const body = await c.req.json();
  const appUrl = await $env.get("APP_URL") || "";
  const baseUrl = await $env.get("BASE_URL") || "";
  const localBaseUrl = await $env.get("LOCAL_BASE_URL") || "";
  const localAppUrl = await $env.get("LOCAL_APP_URL") || "";
  const date = new Date().toISOString()
  console.log("New log: ", date)
  return new Response({ message: "Hello!", baseUrl,appUrl,localAppUrl,localBaseUrl,req:c.req.raw.auth, date, body });
});
// ---------------------------------------------------------
// Fast Image Streaming with Photon, Native Storage Fallback & $fs VFS Cache (GET /preview/:id/:filename)
// ---------------------------------------------------------
app.get("/preview/:id/:filename", async (c) => {
  const id = Number(c.req.param("id"));
  const filename = c.req.param("filename");

  try {
    const target = await $db.records.get(COLLECTION, id);
    if (!target) return c.text("File record not found", 404);

    const storageFilename = target.data?.physical_file || target.data?.metadata?.storage_filename;
    if (!storageFilename) return c.text("No storage binary linked", 404);

    const vfsCacheDir = "processed_media";
    const vfsCachedPath = `${vfsCacheDir}/opt_${storageFilename}`;

    // 1. Instant Cache Hit: Serve pre-processed binary directly from $fs VFS
    if (typeof $fs?.exists === 'function' && await $fs.exists(vfsCachedPath)) {
      const b64 = typeof $fs.readBytes === 'function' ? await $fs.readBytes(vfsCachedPath) : await $fs.read(vfsCachedPath);
      const buffer = $util.base64DecodeBuffer(b64);

      return new Response(buffer, {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": String(buffer.byteLength || buffer.length),
          "Cache-Control": "public, max-age=31536000, immutable",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // 2. Fetch original binary bytes from Storage
    const rawBase64 = await $files.read(storageFilename);
    const arrayBuffer = $util.base64DecodeBuffer(rawBase64);
    const inputBytes = new Uint8Array(arrayBuffer);

    let outputBytes = null;
    let mimeType = "image/webp";

    // 3. Attempt in-memory processing via Photon WASM
    try {
      const { default: initPhoton, resize, PhotonImage } = await import("https://esm.sh/@silvia-odwyer/photon@0.3.3");
      await initPhoton("https://esm.sh/@silvia-odwyer/photon@0.3.3/es2022/photon_rs_bg.wasm");

      const img = PhotonImage.new_from_byteslice(inputBytes);
      const origWidth = img.get_width();
      const origHeight = img.get_height();

      let processedImg = img;
      const maxDim = 1920;
      if (origWidth > maxDim || origHeight > maxDim) {
        const ratio = Math.min(maxDim / origWidth, maxDim / origHeight);
        const targetW = Math.round(origWidth * ratio);
        const targetH = Math.round(origHeight * ratio);
        processedImg = resize(img, targetW, targetH, 1);
      }

      const photonBytes = processedImg.get_bytes_jpeg(80);

      if (processedImg !== img) processedImg.free?.();
      img.free?.();

      // Ensure Photon output actually compressed and did not balloon
      if (photonBytes && photonBytes.length < inputBytes.length) {
        outputBytes = photonBytes;
        mimeType = "image/jpeg";
      }
    } catch (photonErr) {
      console.warn(`[Photon] Processing failed for ${storageFilename}:`, photonErr.message);
    }

    // 4. Fallback: If Photon failed or ballooned in size, fetch from native backend transformer
    if (!outputBytes) {
      try {
        const localAppUrl = (await $env.get("LOCAL_APP_URL")) || $env.APP_URL || "";
        const base = localAppUrl.replace(/\/$/, "");
        const nativeUrl = `${base}/api/v1/storage/file/${storageFilename}?quality=80&format=webp`;

        const fallbackRes = await fetch(nativeUrl);
        if (fallbackRes.ok) {
          const ab = await fallbackRes.arrayBuffer();
          outputBytes = new Uint8Array(ab);
          mimeType = "image/webp";
        }
      } catch (fetchErr) {
        console.warn(`[Native Fetch Fallback Error]`, fetchErr.message);
      }
    }

    // 5. Ultimate Fallback: Serve original raw bytes if both steps fail
    if (!outputBytes) {
      outputBytes = inputBytes;
      mimeType = "application/octet-stream";
    }

    // 6. Cache the optimized image with $fs for all subsequent requests
    try {
      if (typeof $fs?.mkdir === 'function') await $fs.mkdir(vfsCacheDir);
      const outB64 = $util.base64Encode(outputBytes);
      if (typeof $fs?.writeBytes === 'function') {
        await $fs.writeBytes(vfsCachedPath, outB64);
      } else {
        if (typeof $fs?.write === 'function') {
          await $fs.write(vfsCachedPath, outB64);
        }
      }
    } catch (vfsErr) {
      console.warn(`[VFS Cache Warning] Could not cache ${storageFilename}:`, vfsErr);
    }

    // 7. Stream optimized binary payload
    return new Response(outputBytes, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(outputBytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (e) {
    console.error(`[Image Preview Exception]`, e);
    return c.text(`Image stream error: ${e.message}`, 500);
  }
});
export default async function (req) {
  return app.fetch(req);
}