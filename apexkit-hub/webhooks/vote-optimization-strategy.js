export const __fileMetadata__ = {
  "id": 31,
  "name": "vote-optimization-strategy",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

/**
 * ApexKit Vote Optimization Strategy Service
 * Script Name: vote-optimization-strategy
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

    // 2. Parse Input
    const body = await req.json();
    const optimization_id = Number(body.optimization_id) || body.optimization_id;
    const type = body.type;

    if (!['up', 'down'].includes(type)) {
        return new Response({ error: "Invalid vote type. Must be 'up' or 'down'." }, { status: 400 });
    }

    // 3. Check existing vote
    const voteData = await $db.records.list("optimizations_votes", {
        filter: JSON.stringify({
            optimization_id: optimization_id,
            voter_id: userId
        })
    }).catch(() => ({ items: [] }));

    const existingVotes = (voteData && voteData.items) ? voteData.items : [];

    let action = "voted";

    if (existingVotes.length > 0) {
        const vote = existingVotes[0]?.data;
        const voteId = existingVotes[0]?.id;

        if (vote && vote.type === type) {
            // Toggling off (removing vote)
            await $db.records.delete("optimizations_votes", voteId);
            action = "removed";
        } else {
            // Changing vote (up -> down or vice versa)
            await $db.records.update("optimizations_votes", voteId, { type: type });
            action = "changed";
        }
    } else {
        // New Vote
        await $db.records.create("optimizations_votes", {
            optimization_id: optimization_id,
            voter_id: userId,
            type: type
        });
    }

    // 4. Recalculate Totals
    const allVotes = await $db.records.list("optimizations_votes", {
        filter: JSON.stringify({
            optimization_id: optimization_id
        }),
        limit: 5000
    }).catch(() => ({ items: [] }));

    let up = 0;
    let down = 0;

    const voteItems = (allVotes && allVotes.items) ? allVotes.items : [];
    for (let i = 0; i < voteItems.length; i++) {
        if (voteItems[i]?.data?.type === 'up') up++;
        else down++;
    }

    // 5. Update Parent Record
    await $db.records.update("optimizations", optimization_id, {
        upvotes: up,
        downvotes: down
    });

    return new Response({
        success: true,
        action,
        upvotes: up,
        downvotes: down,
        user_vote: action === "removed" ? null : type
    });
}