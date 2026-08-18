export const __fileMetadata__ = {
  "id": 406,
  "name": "test-wasm",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

// webhooks/test-wasm.js
export default async function (req) {
  // Executes add.wasm in 0ms using the precompiled .cwasm
  const sum = await $wasm.call("add.wasm", "add", [15, 27]);

  return new Response(JSON.stringify({
    success: true,
    result: sum // Output: 42
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}