export const __fileMetadata__ = {
  "id": 10,
  "name": "get-release-info",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

export default async function (req) {
    try {
        const OWNER = "deniskipeles";
        const REPO = "apexkit";

        // 1. Fetch metadata (No token needed for public repos)
        const metadataUrl = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
        const releaseRes = await fetch(metadataUrl, {
            headers: {
                "User-Agent": "ApexKit" // GitHub API strictly requires a User-Agent
            }
        });

        if (!releaseRes.ok) {
            throw new Error(`GitHub API error: ${releaseRes.status} ${releaseRes.statusText}`);
        }

        const release = await releaseRes.json();

        // Debug: Print all assets to console
        const assetNames = release.assets.map(a => a.name);
        console.log("Current Release Assets: " + assetNames.join(", "));

        // 2. Try to find the checksums file
        const checksumAsset = release.assets.find(a => a.name.toLowerCase().includes("checksum"));

        let checksumContent = "";
        if (checksumAsset) {
            console.log("Downloading checksum file via public URL: " + checksumAsset.name);

            // For public repos, fetching the browser_download_url is the most reliable way 
            // to get the file content without authentication.
            const fileRes = await fetch(checksumAsset.browser_download_url, {
                headers: {
                    "User-Agent": "ApexKit"
                }
            });

            if (fileRes.ok) {
                checksumContent = await fileRes.text();
            } else {
                console.log("Failed to download checksum file asset. Falling back to release body.");
                checksumContent = release.body || "";
            }
        } else {
            // FALLBACK: If no file exists, use the Release Notes (Body) 
            console.log("No checksum asset found. Using release description as source.");
            checksumContent = release.body || "";
        }

        return new Response({
            version: release.tag_name,
            date: release.published_at,
            checksums: checksumContent,
            body: release.body
        });

    } catch (err) {
        console.error("Script error: " + err.message);
        return new Response({ error: err.message }, { status: 500 });
    }
}