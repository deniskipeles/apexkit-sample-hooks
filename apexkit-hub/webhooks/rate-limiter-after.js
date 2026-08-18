export const __fileMetadata__ = {
  "id": 7,
  "name": "rate-limiter-after",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "after_tenant_request",
  "active": false,
  "visibility": "private"
};

export default async function (e) {
    const tenant = e.data.tenant_id;
    const ip = e.data.ip;
    
    const ipKey = `ip:${tenant}:${ip}`;
    console.log(JSON.stringify(e.data));
    console.log(ipKey, "After");

}