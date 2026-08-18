export const __fileMetadata__ = {
  "id": 367,
  "name": "calculate-score",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

export default async function (req) {
    const body = await req.json().catch(() => ({}));
    const val1 = body.val1 || 10;
    const val2 = body.val2 || 32;

    // Base64 representation of a simple WASM module exporting `add(a, b)`
    const wasmBase64 = "AGFzbQEAAAABBwFgAn9/AX8DAgEABxcBB2FkZF90d28AAwAJCAEHACAAIAFqCw==";

    // Calls export `add_two` with arguments [val1, val2]
    // On the first run, this caches `.cache/wasm/<sha256>.cwasm` for 0ms execution on future runs.
    const result = await $wasm.call("add.wasm", "add", [val1, val2]);

    return new Response(JSON.stringify({
        success: true,
        input: { val1, val2 },
        wasm_result: result // Output: 42
    }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
    });
}