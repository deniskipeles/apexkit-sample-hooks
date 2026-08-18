/** @type {import("../apexkit").FileMetadata} */
export const __fileMetadata__ = {
  "name": "file-system",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

/**
 * HTTP Webhook: file-system
 * Endpoint: /api/v1/run/file-system (or /api/v1/webhook/file-system)
 * 
 * @param {Request} req - The standard incoming WHATWG Request object
 * @returns {Promise<Response>}
 */
export default async function (req) {
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));

  await $fs.mkdir("test-1");
  
  // Perform custom API operations
  return new Response(JSON.stringify({
    success: true,
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    received: body
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
