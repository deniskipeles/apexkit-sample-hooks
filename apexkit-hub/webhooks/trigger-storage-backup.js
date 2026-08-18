export const __fileMetadata__ = {
  "id": 2,
  "name": "trigger-storage-backup",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

export default async function(req) {
    try {
        // 1. Create a unique lock key for the current minute
        // e.g., "2026-05-19T10:18"
        const currentMinute = new Date().toISOString().slice(0, 16); 
        const lockKey = "backup_lock_" + currentMinute;

        // 2. Check the cache to see if we already triggered a backup this minute
        const alreadyFired = await $cache.get(lockKey);
        if (alreadyFired) {
            console.log("⏭️ Backup already running for this minute. Skipping duplicate trigger.");
            return new Response({ success: true, message: "Skipped duplicate" });
        }

        // 3. Immediately set the lock with a 60-second TTL (Time-To-Live)
        await $cache.set(lockKey, "locked", 60);

        console.log("⏰ Cron Triggered: Starting auto-backup...");
        
        // 4. Send a POST request to our invisible background Flask container
        const res = await fetch("http://127.0.0.1:5000/backup", {
            method: "POST"
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.message || "Backup failed");
        }
        
        console.log("✅ Backup Success: " + data.message);
        return new Response({ success: true, details: data });
        
    } catch (e) {
        console.error("❌ Backup Error: " + e.message);
        return new Response({ success: false, error: e.message }, { status: 500 });
    }
}