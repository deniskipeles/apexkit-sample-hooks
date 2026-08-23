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
import { Hono } from "https://esm.sh/hono";
import { generateFilePreview } from "@/custom/media-preview";

const app = new Hono();
app.post("/", async (c) => {
  const body = await c.req.json();
  const appUrl = await $env.get("APP_URL") || "";
  const baseUrl = await $env.get("BASE_URL") || "";
  const localBaseUrl = await $env.get("LOCAL_BASE_URL") || "";
  const localAppUrl = await $env.get("LOCAL_APP_URL") || "";
  const date = new Date().toISOString()
  console.log("New log: ", date)
  return new Response({ message: "Hello!", baseUrl,appUrl,localAppUrl,localBaseUrl,req:c.req.raw, date, body });
});

export default async function (req) {
  return app.fetch(req);
}