export const __fileMetadata__ = {
  "id": 14,
  "name": "inspect-archive",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

// Script Name: inspect-archive
// Trigger Type: manual
// Visibility: public

export default async function(req) {
    const { filename } = await req.json();
    
    // 1. Read file from storage (Root scope usually for ecosystem)
    // $zip.readFile returns base64
    const b64 = await $zip.readFile(filename); 
    
    // 2. Inspect Metadata
    const meta = await $zip.inspect(b64);
    
    return new Response(meta);
}