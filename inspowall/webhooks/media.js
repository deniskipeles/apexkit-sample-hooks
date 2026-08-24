/** @type {import("../apexkit").FileMetadata} */
export const __fileMetadata__ = {
  "id": 27,
  "name": "media",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

import { Hono } from "https://esm.sh/hono";
import { processAndCacheImage } from "@/custom/media-helper";

const app = new Hono();

// =========================================================
// PROXIED & CACHED IMAGE STREAM (GET /image/:filename)
// =========================================================
app.get("/image/:filename", async (c) => {
  const filename = c.req.param("filename");
  const thumb = c.req.query("thumb") || "orig";
  const quality = c.req.query("quality") || "80";
  const format = c.req.query("format") || "webp";

  try {
    const result = await processAndCacheImage(filename, {
      thumb,
      quality,
      format
    });

    return new Response(result.buffer, {
      status: 200,
      headers: {
        "Content-Type": result.mimeType,
        "Content-Length": String(result.buffer.byteLength || result.buffer.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Media-Cache": result.hit ? "HIT" : "MISS",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (err) {
    return c.text(`Media stream error: ${err.message}`, 404);
  }
});

export default async function (req) {
  return app.fetch(req);
}