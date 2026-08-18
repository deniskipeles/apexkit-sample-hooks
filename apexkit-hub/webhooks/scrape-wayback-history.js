export const __fileMetadata__ = {
  "id": 25,
  "name": "scrape-wayback-history",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

/**
 * Wayback Machine Metadata Harvester
 * 
 * 1. Fetches snapshot history from Internet Archive CDX API.
 * 2. Parses timestamps and metadata.
 * 3. Formats data for Vector Search (Semantic Context).
 * 4. Bulk inserts into 'wayback_snapshots'.
 * 
 * @param {string} url - The target URL (e.g. "google.com")
 * @param {number} [limit=100] - Max snapshots to fetch (newest first)
 */
export default async function (req) {
    const { url, limit = 50 } = await req.json();

    if (!url) {
        return new Response({ error: "URL is required" }, { status: 400 });
    }

    console.log(`[Wayback] Harvesting metadata for: ${url}`);

    // 1. Query the CDX API
    // fl = field list (timestamp, original, mimetype, statuscode, digest, length)
    // filter = only successful 200 scans
    // collapse = digest (remove duplicate scans of exact same content)
    const cdxApi = `https://web.archive.org/cdx/search/cdx?url=${url}&output=json&fl=timestamp,original,mimetype,statuscode,digest&filter=statuscode:200&collapse=digest&limit=${limit}`;

    const res = await fetch(cdxApi);

    if (!res.ok) {
        return new Response({ error: "Failed to connect to Internet Archive" }, { status: 502 });
    }

    const data = await res.json();

    // The API returns an array of arrays. The first row is the header.
    // [ ["timestamp", "original", ...], ["20230101...", "http://...", ...] ]
    if (!data || data.length < 2) {
        return new Response({ message: "No snapshots found", count: 0 });
    }

    const headers = data.shift(); // Remove header row
    let insertedCount = 0;

    // 2. Process and Insert
    for (const row of data) {
        const ts = row[0];       // timestamp
        const orig = row[1];     // original url
        const mime = row[2];     // mimetype
        const status = row[3];   // statuscode
        const digest = row[4];   // digest

        // Format ISO Date: YYYYMMDDHHMMSS -> YYYY-MM-DDTHH:MM:SSZ
        const isoDate = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`;

        // Construct the View URL
        const archiveLink = `https://web.archive.org/web/${ts}/${orig}`;

        // Create Semantic Context for Vector Engine
        // This allows you to search "PDFs from 2019" or "images of google" via AI
        const vectorContext = `Snapshot of ${orig} captured on ${isoDate}. Content type is ${mime}. Archive ID ${digest}.`;

        try {
            // Check for duplicates before inserting (optional, slows it down but cleaner)
            // Or rely on a unique composite key in schema if you configured one.
            const existing = await $db.records.list("wayback_snapshots", {
                filter: { digest: digest },
                limit: 1
            });

            if (existing.total === 0) {
                await $db.records.create("wayback_snapshots", {
                    target_url: orig,
                    archive_url: archiveLink,
                    timestamp: ts,
                    capture_date: isoDate,
                    mime_type: mime,
                    status_code: parseInt(status),
                    digest: digest,
                    context: vectorContext // This gets embedded automatically!
                });
                insertedCount++;
            }
        } catch (err) {
            console.log(`[Wayback] Insert Error: ${err.toString()}`);
        }
    }

    return new Response({
        success: true,
        target: url,
        found_snapshots: data.length,
        newly_indexed: insertedCount
    });
}