export const __fileMetadata__ = {
  "id": 8,
  "name": "test-get-disk-usage",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

// Trigger: manual
export default async function (req) {
    const tenantId = (await req.json()).name;

    // Get usage in bytes
    const usageBytes = await $root.getTenantDiskUsage(tenantId);
    const usageMB = (usageBytes / 1024 / 1024).toFixed(2);

    // Check if over limit (e.g. 500MB)
    if (usageBytes > 524288000) {
        log(`WARNING: Tenant ${tenantId} is over quota: ${usageMB} MB`);
        // Maybe suspend?
        // await $root.updateTenantStatus(tenantId, "suspended");
    }

    return new Response({
        tenant: tenantId,
        usage_bytes: usageBytes,
        usage_mb: usageMB
    });
}