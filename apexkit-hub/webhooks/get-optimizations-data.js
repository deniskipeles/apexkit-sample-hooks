export const __fileMetadata__ = {
  "id": 33,
  "name": "get-optimizations-data",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

/**
 * ApexKit Optimizations Data Service
 * Script Name: get-optimizations-data
 */
export default async function (req) {
    if (req.method !== "GET") {
        return new Response({ error: "Method Not Allowed. Only GET is supported." }, { status: 405 });
    }

    // 1. Safely parse query parameters from req.url
    function getQueryParam(urlStr, paramName) {
        if (!urlStr || urlStr.indexOf('?') === -1) return null;
        const queryString = urlStr.split('?')[1];
        const pairs = queryString.split('&');
        for (let i = 0; i < pairs.length; i++) {
            const pair = pairs[i].split('=');
            if (pair[0] === paramName) {
                return pair[1] ? decodeURIComponent(pair[1]) : '';
            }
        }
        return null;
    }

    const pageStr = getQueryParam(req.url, "page");
    const page = parseInt(pageStr || "1", 10) || 1;
    const perPage = 20;

    // 2. Identify Authenticated User (if present)
    let currentUserId = null;
    if (req.auth && req.auth.id) {
        currentUserId = req.auth.id;
    } else {
        const authHeader = req.headers.get("authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
            try {
                const tokenParts = authHeader.split(" ")[1].split(".");
                if (tokenParts.length === 3) {
                    const claims = JSON.parse($util.base64Decode(tokenParts[1]));
                    currentUserId = claims.uid;
                }
            } catch (e) { }
        }
    }

    // 3. Fetch optimizations to extract top 50 distinct tags
    const allOptsRes = await $db.records.list("optimizations", {
        limit: 5000 // Safely bound global tag aggregation
    }).catch(() => ({ items: [] }));

    const allOpts = (allOptsRes && allOptsRes.items) ? allOptsRes.items : [];

    // Aggregate tag counts
    const tagCounts = {};
    for (const item of allOpts) {
        let tags = [];
        if (Array.isArray(item.data?.tags)) {
            tags = item.data.tags;
        } else if (typeof item.data?.tags === "string") {
            try { tags = JSON.parse(item.data.tags); } catch (e) { tags = []; }
        }

        for (const t of tags) {
            const cleanTag = String(t).trim();
            if (cleanTag) {
                tagCounts[cleanTag] = (tagCounts[cleanTag] || 0) + 1;
            }
        }
    }

    // Guard against empty array .sort() panic
    const rawTagKeys = Object.keys(tagCounts);
    let topTags = [];
    if (rawTagKeys.length > 0) {
        topTags = rawTagKeys
            .sort((a, b) => tagCounts[b] - tagCounts[a])
            .slice(0, 50);
    }

    // 4. Fetch Paginated List of Optimizations
    const paginatedRes = await $db.records.list("optimizations", {
        page: page,
        per_page: perPage,
        sort: "-created",
        expand: "author_id"
    }).catch(() => ({ items: [], total: 0 }));

    const items = (paginatedRes && paginatedRes.items) ? paginatedRes.items : [];
    const total = (paginatedRes && paginatedRes.total) ? paginatedRes.total : 0;

    // 5. Process Items: Truncate, Expand Comments, and Determine User Vote Status
    const processedItems = [];

    for (const item of items) {
        // Fetch Comments
        const commentsRes = await $db.records.list("optimizations_conversations", {
            filter: JSON.stringify({ optimization_id: item.id }),
            limit: 10,
            sort: "created",
            expand: "author_id"
        }).catch(() => ({ items: [], total: 0 }));

        // Check if the current user has voted on this item
        let userVote = null;
        if (currentUserId) {
            const voteRes = await $db.records.list("optimizations_votes", {
                filter: JSON.stringify({ optimization_id: item.id, voter_id: currentUserId }),
                limit: 1
            }).catch(() => ({ items: [] }));

            if (voteRes && voteRes.items && voteRes.items.length > 0) {
                userVote = voteRes.items[0].data?.type || null; // 'up' or 'down'
            }
        }

        // Generate Trucated Preview Content
        let rawContent = item.data?.content || "";
        let truncatedContent = rawContent.length > 150
            ? rawContent.substring(0, 150) + "..."
            : rawContent;

        processedItems.push({
            id: item.id,
            data: {
                ...item.data,
                content: truncatedContent, // Only send the preview to the list
                user_vote: userVote        // Attach the calculated user state
            },
            created: item.created,
            updated: item.updated,
            expand: {
                ...item.expand,
                comments: (commentsRes && commentsRes.items) ? commentsRes.items : [],
                comments_count: (commentsRes && commentsRes.total) ? commentsRes.total : 0
            }
        });
    }

    return new Response({
        success: true,
        tags: topTags,
        items: processedItems,
        total: total,
        page: page,
        per_page: perPage
    });
}