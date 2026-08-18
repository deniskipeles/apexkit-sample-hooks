export const __fileMetadata__ = {
  "id": 13,
  "name": "vote-optimization",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

export default async function (req) {
    // 1. Authenticate User
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return new Response({ error: "Unauthorized" }, { status: 401 });

    // Decode JWT (Basic extraction)
    const tokenParts = authHeader.split(" ")[1].split(".");
    const claims = JSON.parse($util.base64Decode(tokenParts[1]));
    const userId = claims.uid;

    // 2. Parse Input
    const { optimization_id, type } = await req.json();
    if (!['up', 'down'].includes(type)) {
        return new Response({ error: "Invalid vote type" }, { status: 400 });
    }

    // 3. Check existing vote
    const voteData = await $apex.collection("optimizations_votes").list({
        filter: JSON.stringify({
            optimization_id: optimization_id,
            voter_id: userId
        })
    });
    console.log(JSON.stringify(voteData))
    const existingVotes = voteData.items.length ? voteData.items : [];

    let action = "voted";

    if (existingVotes.length > 0) {
        const vote = existingVotes[0]?.data;
        const voteId = existingVotes[0]?.id;

        if (vote.type === type) {
            // Toggling off (removing vote)
            await $db.records.delete(null, 'optimizations_votes', voteId);
            action = "removed";
        } else {
            // Changing vote (up -> down or vice versa)
            await $db.records.update(null, 'optimizations_votes', voteId, { type: type });
            action = "changed";
        }
    } else {
        // New Vote
        await $db.records.create(null, 'optimizations_votes', {
            optimization_id: optimization_id,
            voter_id: userId,
            type: type
        });
    }

    // 4. Recalculate Totals (Aggregation)
    // We fetch all votes for this item to ensure consistency
    const allVotes = await $apex.collection("optimizations_votes").list({
        filter: JSON.stringify({
            optimization_id: optimization_id
        })
    });

    let up = 0;
    let down = 0;

    for (let i = 0; i < allVotes.items.length; i++) {
        if (allVotes.items[i]?.data.type === 'up') up++;
        else down++;
    }

    // 5. Update Parent Record
    await $db.records.update(null, 'optimizations', optimization_id, {
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