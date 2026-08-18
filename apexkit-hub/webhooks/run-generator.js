export const __fileMetadata__ = {
  "id": 407,
  "name": "run-generator",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

export default async function (req) {
  // Read a compiled Rust/C WASI binary stored in ApexKit File Storage
  // $files.read() automatically returns a Base64-encoded string
  const wasiBinaryB64 = await $files.read("pdf_generator.wasm");

  // Run the WASI `_start` entrypoint with CLI arguments
  const success = await $wasm.runWasi(wasiBinaryB64, [
    "--output-format", "json",
    "--verbose"
  ]);

  return new Response(JSON.stringify({
    executed: success,
    message: "WASI program finished execution."
  }));
}