/** @type {import("../apexkit").FileMetadata} */
export const __fileMetadata__ = {
  "id": 23,
  "name": "media-helper",
  "extension": "js",
  "target_collection": null,
  "type": "custom:module",
  "path": "./modules/custom/",
  "trigger_type": "manually",
  "active": true,
  "visibility": "private"
};

/** @type {import("../../apexkit").FileMetadata} */


const VFS_MEDIA_DIR = "processed_media";

/**
 * Checks and reads an optimized image directly from $fs VFS
 */
export async function getCachedMedia(cacheKey) {
  const vfsPath = `${VFS_MEDIA_DIR}/${cacheKey}`;
  if (typeof $fs?.exists === "function" && (await $fs.exists(vfsPath))) {
    const b64 =
      typeof $fs.readBytes === "function"
        ? await $fs.readBytes(vfsPath)
        : await $fs.read(vfsPath);
    return $util.base64DecodeBuffer(b64);
  }
  return null;
}

/**
 * Saves processed image bytes to $fs VFS
 */
export async function saveCachedMedia(cacheKey, arrayBuffer) {
  try {
    if (typeof $fs?.mkdir === "function") await $fs.mkdir(VFS_MEDIA_DIR);
    const vfsPath = `${VFS_MEDIA_DIR}/${cacheKey}`;
    const b64 = $util.base64EncodeBuffer(arrayBuffer);

    if (typeof $fs?.writeBytes === "function") {
      await $fs.writeBytes(vfsPath, b64);
    } else if (typeof $fs?.write === "function") {
      await $fs.write(vfsPath, b64);
    }
  } catch (e) {
    console.warn(`[VFS Cache] Failed to save ${cacheKey}:`, e.message);
  }
}

/**
 * Resolves, compresses, and caches any storage image
 */
export async function processAndCacheImage(storageFilename, options = {}) {
  const thumb = options.thumb || "orig";
  const quality = Math.min(Math.max(Number(options.quality) || 80, 10), 100);
  const format = (options.format || "webp").toLowerCase();

  const safeFilename = storageFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const cacheKey = `opt_${safeFilename}_${thumb}_q${quality}.${format}`;

  // 1. Instant Cache Hit from $fs
  const cachedBuffer = await getCachedMedia(cacheKey);
  if (cachedBuffer) {
    return {
      buffer: cachedBuffer,
      mimeType: format === "jpeg" || format === "jpg" ? "image/jpeg" : format === "png" ? "image/png" : "image/webp",
      hit: true
    };
  }

  // 2. Fetch original binary bytes from Storage
  let inputBytes = null;
  try {
    const rawB64 = await $files.read(storageFilename);
    const ab = $util.base64DecodeBuffer(rawB64);
    inputBytes = new Uint8Array(ab);
  } catch (e) {
    throw new Error(`File '${storageFilename}' not found in storage: ${e.message}`);
  }

  let outputBytes = null;
  let mimeType = format === "jpeg" || format === "jpg" ? "image/jpeg" : "image/webp";

  // 3. In-memory processing via Photon WASM
  try {
    const { default: initPhoton, resize, PhotonImage } = await import(
      "https://esm.sh/@silvia-odwyer/photon@0.3.3"
    );
    await initPhoton("https://esm.sh/@silvia-odwyer/photon@0.3.3/es2022/photon_rs_bg.wasm");

    const img = PhotonImage.new_from_byteslice(inputBytes);
    const origWidth = img.get_width();
    const origHeight = img.get_height();

    let targetW = origWidth;
    let targetH = origHeight;

    if (thumb && thumb !== "orig") {
      const [wStr, hStr] = thumb.split("x");
      const reqW = parseInt(wStr, 10) || 0;
      const reqH = parseInt(hStr, 10) || 0;

      if (reqW > 0 && reqH > 0) {
        targetW = reqW;
        targetH = reqH;
      } else if (reqW > 0) {
        const ratio = reqW / origWidth;
        targetW = reqW;
        targetH = Math.round(origHeight * ratio);
      } else if (reqH > 0) {
        const ratio = reqH / origHeight;
        targetH = reqH;
        targetW = Math.round(origWidth * ratio);
      }
    }

    let processedImg = img;
    if (targetW !== origWidth || targetH !== origHeight) {
      processedImg = resize(img, targetW, targetH, 1);
    }

    const photonBytes = processedImg.get_bytes_jpeg(quality);

    if (processedImg !== img) processedImg.free?.();
    img.free?.();

    if (photonBytes && photonBytes.length > 0) {
      outputBytes = photonBytes;
      mimeType = "image/jpeg";
    }
  } catch (photonErr) {
    console.warn(`[Photon] WASM processing skipped for ${storageFilename}:`, photonErr.message);
  }

  // 4. Native Engine Fallback if Photon fails
  if (!outputBytes) {
    try {
      const localAppUrl = (await $env.get("LOCAL_APP_URL")) || "http://127.0.0.1:5000";
      const nativeUrl = `${localAppUrl.replace(/\/$/, "")}/api/v1/storage/file/${storageFilename}?thumb=${thumb}&quality=${quality}&format=${format}`;

      const fallbackRes = await fetch(nativeUrl);
      if (fallbackRes.ok) {
        const ab = await fallbackRes.arrayBuffer();
        outputBytes = new Uint8Array(ab);
        mimeType = fallbackRes.headers.get("content-type") || mimeType;
      }
    } catch (fetchErr) {
      console.warn(`[Native Fallback] Could not fetch native transform:`, fetchErr.message);
    }
  }

  // 5. Ultimate Fallback: Original Bytes
  if (!outputBytes) {
    outputBytes = inputBytes;
    mimeType = "application/octet-stream";
  }

  // 6. Cache into $fs for all future requests
  const finalBuffer = outputBytes.buffer.slice(
    outputBytes.byteOffset,
    outputBytes.byteOffset + outputBytes.byteLength
  );
  await saveCachedMedia(cacheKey, finalBuffer);

  return {
    buffer: finalBuffer,
    mimeType,
    hit: false
  };
}