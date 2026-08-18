export const __fileMetadata__ = {
  "id": 9,
  "name": "get-latest-binary",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

export default async function (req) {
    const body = await req.json();
    const os = body.os || "linux";

    const OWNER = "deniskipeles";
    const REPO = "apexkit";

    // 1. Fetch metadata (No token needed for public repos)
    const metadataUrl = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
    const releaseRes = await fetch(metadataUrl, {
        headers: {
            "User-Agent": "ApexKit" // GitHub API strictly requires a User-Agent
        }
    });

    if (!releaseRes.ok) return new Response({ error: "GitHub API Error" }, { status: 500 });
    const release = await releaseRes.json();

    // 2. Find Asset
    let pattern = os === "windows" ? "x86_64-pc-windows" : "linux-musl";
    if (os === "macos") pattern = "apple-darwin";

    const asset = release.assets.find(a => a.name.toLowerCase().includes(pattern));

    if (!asset) return new Response({ error: "Asset not found" }, { status: 404 });

    console.log(`[Debug] Resolving download for: ${asset.name}`);

    // 3. Use System Curl to get the signed URL (Head request only)
    // We use -I (head), -L (follow redirects? NO, we want the location), 
    // Actually, GitHub API auth redirection is tricky.
    // If we use the API URL with Accept: octet-stream, it returns 302.
    // We want to capture that 302 Location.
    // curl -I automatically stops at headers. But if we use -L it follows. So DON'T use -L.

    try {
        const curlArgs = [
            "-I", // Fetch headers only
            "-s", // Silent
            // "-H", `Authorization: Bearer ${token}`,
            "-H", "Accept: application/octet-stream",
            "-H", "User-Agent: ApexKit",
            asset.url // The API URL
        ];

        const result = await $cmd.run("curl", curlArgs);

        if (result.status !== 0) {
            return new Response({ error: "Curl failed", stderr: result.stderr }, { status: 500 });
        }

        // 4. Parse Headers from stdout
        // Curl -I outputs HTTP headers to stdout
        const output = result.stdout;
        const lines = output.split(/[\r\n]+/);

        let location = null;
        for (const line of lines) {
            if (line.toLowerCase().startsWith("location:")) {
                location = line.substring(9).trim();
                break;
            }
        }

        if (location) {
            return new Response({
                success: true,
                downloadUrl: location,
                filename: asset.name
            });
        } else {
            // If no location header, maybe it returned 200 directly? (Unlikely for octet-stream API)
            // Or maybe auth failed (404/403).
            // Let's log the output for debug.
            console.log(`[Debug] Curl Output: ${output}`);
            return new Response({ error: "No Location header found in curl response" }, { status: 502 });
        }

    } catch (e) {
        return new Response({ error: e.toString() }, { status: 500 });
    }
}