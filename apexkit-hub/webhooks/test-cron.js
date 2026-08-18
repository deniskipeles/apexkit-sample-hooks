export const __fileMetadata__ = {
  "name": "test-cron",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "graphql",
  "active": true,
  "visibility": "private"
};

export default async function (event) {
  console.log("Trigger graphql executed in test-cron");
  return true;
}
