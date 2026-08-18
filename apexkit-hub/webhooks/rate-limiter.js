export const __fileMetadata__ = {
  "id": 6,
  "name": "rate-limiter",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "before_tenant_request",
  "active": false,
  "visibility": "private"
};

export default async function (e) {
    const tenant = e.data.tenant_id;
    const ip = e.data.ip;

    // 1. Global Quota (e.g. 1000 reqs/hour per tenant)
    // Key format: quota:tenantId:timestamp_hour
    const currentHour = new Date().toISOString().slice(0, 13); // "2023-10-27T10"
    const quotaKey = `quota:${tenant}:${currentHour}`;

    // Increment
    const count = await $cache.incr(quotaKey, 1);

    // Check limit
    if (count > 1000) {
        console.log(`Tenant ${tenant} exceeded quota: ${count}`);
        throw new Error("Hourly quota exceeded");
    }

    // 2. IP Rate Limit (DDOS protection)
    const ipKey = `ip:${tenant}:${ip}`;
    const ipCount = await $cache.incr(ipKey, 1);
    console.log(JSON.stringify(e.data));
    console.log(ipKey, ipCount);

    // Block if > 10 requests in short burst (logic implies we expire keys externally or just let them grow for now)
    if (ipCount > 50  && tenant) {
        throw new Error("Too many requests");
    }
}