export const __fileMetadata__ = {
  "id": 418,
  "name": "image-resizer",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

import init, { resize, PhotonImage } from "https://esm.sh/@silvia-odwyer/photon@0.3.3";

export default async function (req) {
  // 1. Initialize Photon WASM binary in-memory
  await init("https://esm.sh/@silvia-odwyer/photon@0.3.3/es2022/photon_rs_bg.wasm");

  // 2. Parse request parameters from JSON body or URL Query Params
  const urlObj = new URL(req.url);
  const body = await req.json().catch(() => ({}));

  const imageUri = body.uri || body.image || body.url || urlObj.searchParams.get("uri") || urlObj.searchParams.get("url");
  const sizeParam = body.sizes || body.size || urlObj.searchParams.get("size") || urlObj.searchParams.get("sizes") || "200x200";
  const rawFormat = (body.format || urlObj.searchParams.get("format") || "webp").toLowerCase();

  if (!imageUri) {
    return new Response(JSON.stringify({
      error: "Missing image URI",
      message: "Please provide 'uri', 'url', or 'image' via JSON body or query parameter."
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // 3. Resolve Dimensions (Default: 200x200)
  let width = 200;
  let height = 200;
  if (typeof sizeParam === "string" && sizeParam.includes("x")) {
    const [w, h] = sizeParam.toLowerCase().split("x").map((n) => parseInt(n, 10));
    if (w && !isNaN(w)) width = w;
    if (h && !isNaN(h)) height = h;
  } else if (body.width && body.height) {
    width = parseInt(body.width, 10) || 200;
    height = parseInt(body.height, 10) || 200;
  }

  // 4. Fetch raw image bytes into Uint8Array
  let inputBytes;
  try {
    if (imageUri.startsWith("http://") || imageUri.startsWith("https://")) {
      // Remote URL fetch
      const res = await fetch(imageUri);
      if (!res.ok) throw new Error(`HTTP fetch failed with status ${res.status}`);
      const ab = await res.arrayBuffer();
      inputBytes = new Uint8Array(ab);
    } else if (imageUri.startsWith("data:")) {
      // Inline Data URI
      const base64Clean = imageUri.split(",")[1] || imageUri;
      const ab = $util.base64DecodeBuffer(base64Clean);
      inputBytes = new Uint8Array(ab);
    } else {
      // Local ApexKit Storage file lookup
      const base64Data = await $files.read(imageUri);
      const ab = $util.base64DecodeBuffer(base64Data);
      inputBytes = new Uint8Array(ab);
    }
  } catch (err) {
    return new Response(JSON.stringify({
      error: "Image load failed",
      details: err.message
    }), { status: 404, headers: { "Content-Type": "application/json" } });
  }

  // 5. In-Memory Image Resize via Photon
  let outputBytes;
  let mimeType;

  try {
    const img = PhotonImage.new_from_byteslice(inputBytes);
    
    // Sampling filter: 1 = Lanczos3 (high quality)
    const resizedImg = resize(img, width, height, 1);

    // Format selection (Photon encodes to PNG or JPEG in-memory)
    if (rawFormat === "png") {
      outputBytes = resizedImg.get_bytes();
      mimeType = "image/png";
    } else {
      // Defaults to JPEG encoding for webp/jpeg/jpg
      outputBytes = resizedImg.get_bytes_jpeg(85);
      mimeType = (rawFormat === "webp") ? "image/webp" : "image/jpeg";
    }
  } catch (err) {
    return new Response(JSON.stringify({
      error: "Image processing failed",
      details: err.message
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  // 6. Return RAW binary image payload with image Content-Type header (not saved to disk)
  return new Response(outputBytes, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(outputBytes.length),
      "Cache-Control": "public, max-age=86400, immutable"
    }
  });
}