export const __fileMetadata__ = {
  "id": 82,
  "name": "dumb-test",
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
    console.log("New log: ", new Date().toISOString())
    return new Response({ message: "Hello!" });
}