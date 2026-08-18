export const __fileMetadata__ = {
  "id": 32,
  "name": "create-optimization-strategy",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

/**
 * ApexKit Create Optimization Strategy Service
 * Script Name: create-optimization-strategy
 */
export default async function (req) {
    if (req.method !== "POST") {
        return new Response({ error: "Method Not Allowed. Use POST." }, { status: 405 });
    }

    // 1. Authenticate User
    let userId = req.auth ? req.auth.id : null;
    if (!userId) {
        const authHeader = req.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return new Response({ error: "Unauthorized: Missing token" }, { status: 401 });
        }
        try {
            const tokenParts = authHeader.split(" ")[1].split(".");
            const claims = JSON.parse($util.base64Decode(tokenParts[1]));
            userId = claims.uid;
        } catch (e) {
            return new Response({ error: "Unauthorized: Invalid token" }, { status: 401 });
        }
    }

    if (!userId) {
        return new Response({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse Body
    const body = await req.json();
    const title = body.title || "";
    const content = body.content || "";
    const tags = Array.isArray(body.tags) ? body.tags : [];

    if (!title.trim() || !content.trim()) {
        return new Response({ error: "Title and content are required." }, { status: 400 });
    }

    // Generate slug from title
    const slug = `${$util.slugify(title)}-${$util.uuid().substring(0, 6)}`;

    // 3. Create Optimization Record
    const recordId = await $db.records.create("optimizations", {
        title,
        content,
        slug,
        tags,
        upvotes: 0,
        downvotes: 0,
        author_id: userId
    });

    return new Response({
        success: true,
        id: recordId,
        slug: slug
    });
}