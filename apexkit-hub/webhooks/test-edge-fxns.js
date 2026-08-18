export const __fileMetadata__ = {
  "id": 15,
  "name": "test-edge-fxns",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

export default async function (req) {
    const body = await req.json();
    const files = await $fs.list(body.name);
    if (body.mkdir) {
        await $fs.mkdir(body.mkdir)
    }
    if (body.file) {
        await $fs.write("system_config.json", "{}");
    }
    return new Response({ message: "Hello!", files });
}