export const __fileMetadata__ = {
  "id": 365,
  "name": "test-expressjs",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

import express from "https://esm.sh/express";
import serverless from "https://esm.sh/@vendia/serverless-express";

const app = express();

app.get("/", (req, res) => {
  res.json({ message: "Hello World" });
});

// Mock serverless handler instead of app.listen()
const handler = serverless({ app });

export default async function (req) {
  // Converts Web Request -> Express -> Web Response
  return handler(req); 
}