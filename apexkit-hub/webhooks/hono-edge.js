export const __fileMetadata__ = {
  "id": 253,
  "name": "hono-edge",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

import { Hono } from "https://esm.sh/hono";

const app = new Hono();

// Express-like routing
app.get("/", (c) => c.text("Hello World"));

app.get("/users/:id", async (c) => {
    const id = c.req.param("id");
    const doc = await $db.records.get("docs", id);
    return c.json({ userId: id, status: "active", doc });
});

app.post("/data", async (c) => {
    const body = await c.req.json();
    return c.json({ received: body }, 201);
});

// ApexKit default export handler passes incoming Request to Hono
export default async function (req) {
    return app.fetch(req);
}