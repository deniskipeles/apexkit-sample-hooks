export const __fileMetadata__ = {
  "id": 18,
  "name": "check-status",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

export default async function(req) {
    const body = await req.json();
    const proc = await $cmd.status(body.name)
    return new Response({ message: "Hello!", proc });
}