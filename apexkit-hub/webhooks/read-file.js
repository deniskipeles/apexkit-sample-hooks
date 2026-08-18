export const __fileMetadata__ = {
  "id": 11,
  "name": "read-file",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

// Script Name: read-file
// Trigger Type: manual
// Visibility: public

export default async function (req) {
    const { filename } = await req.json();

    // 1. Read
    const b64 = await $zip.readFile(filename);

    // 2. Decode
    const text = $util.base64Decode(b64);

    // 3. Return as JSON if possible, else text
    try {
        return new Response(JSON.parse(text));
    } catch {
        return new Response({ content: text });
    }
}