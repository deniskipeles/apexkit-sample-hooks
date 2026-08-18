export const __fileMetadata__ = {
  "id": 22,
  "name": "system-usage-sync",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": false,
  "visibility": "private"
};

/**
 * System Usage Sync
 * Aggregates storage size and operation counters for all tenants.
 * Must run in Root scope.
 */
export default async function (req) {
    // 1. Get all tenants via the native Admin method
    const tenants = await $root.listTenants();
    const results = [];

    for (const t of tenants) {
        try {
            // A. Calculate Storage Size (MB)
            // We switch to tenant context to query their file metadata
            const tenantCtx = `tenant:${t.id}`;

            // Sum the 'size' column from their local _storage_files table
            // Use $root.db instead of $db to guarantee context switching works
            const storageStats = await $root.db.query(tenantCtx, {
                system: true,
                from: "_storage_files",
                select: [{ fn: "sum", field: "size", as: "total_bytes" }]
            });

            const totalBytes = storageStats[0]?.total_bytes || 0;
            const totalMB = (totalBytes / 1024 / 1024).toFixed(2);

            // B. Fetch Operation Counters from Cache
            const getOps = await $cache.get(`usage:${t.id}:s3_get`) || "0";
            const putOps = await $cache.get(`usage:${t.id}:s3_put`) || "0";

            // C. Update Root Tenant Registry
            await $root.updateTenant(t.id, {
                stats: {
                    ...t.stats,
                    current_storage_mb: parseFloat(totalMB),
                    // Track operations if needed
                }
            });

            console.log(`[Usage Sync] Tenant: ${t.id} | Storage: ${totalMB} MB | S3 Gets: ${getOps} | S3 Puts: ${putOps}`);

            results.push({
                id: t.id,
                storage_mb: totalMB,
                ops: { get: getOps, put: putOps }
            });

        } catch (err) {
            console.error(`Failed to sync usage for ${t.id}: ${err.toString()}`);
        }
    }

    return new Response({ success: true, synced: results.length, details: results });
}