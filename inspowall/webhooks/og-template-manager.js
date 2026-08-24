/** @type {import("../apexkit").FileMetadata} */
export const __fileMetadata__ = {
  "id": 5,
  "name": "og-template-manager",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": false,
  "visibility": "private"
};

export default async function (req) {
  // DEPRECATED: Replaced by /webhook/og powered by Hono and local VFS caching
  return new Response("Deprecated", { status: 404 });
}