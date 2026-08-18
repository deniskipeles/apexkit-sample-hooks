/** @type {import("../apexkit").FileMetadata} */
export const __fileMetadata__ = {
  "name": "test-queue",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

/**
 * HTTP Webhook: test-queue
 * Endpoint: /api/v1/run/test-queue (or /api/v1/webhook/test-queue)
 * 
 * @param {Request} req - The standard incoming WHATWG Request object
 * @returns {Promise<Response>}
 */
export default async function (req) {
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));

  // Spawn a background job (runs up to 60s without blocking the HTTP request)
  const { pid } = await $queue.spawn(async (jobId) => {
    console.log(`Starting background task ${jobId}...`);
    
    // Perform intensive task (e.g. video transcode, AI vectors, large file ETL)
    await $util.sleep(3000);
    
    return {
      status: "done",
      processed_items: 500,
      timestamp: new Date().toISOString()
    };
  }, { timeoutMs: 60000 });
  
  // Perform custom API operations
  return new Response(JSON.stringify({
    success: true,
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
     message: "Background job dispatched successfully",
    pid,
    status_url: `/api/v1/run/check-status?pid=${pid}`,
    received: body
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
