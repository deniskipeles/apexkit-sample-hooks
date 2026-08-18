export const __fileMetadata__ = {
  "id": 270,
  "name": "test-esm",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

import { camelCase } from "https://esm.sh/lodash-es";

export default async function(req) {
    const result = camelCase("hello awesome esm world");
    
    return new Response(JSON.stringify({ 
        success: true, 
        message: "ESM is working perfectly!",
        lodash_output: result
    }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
    });
}