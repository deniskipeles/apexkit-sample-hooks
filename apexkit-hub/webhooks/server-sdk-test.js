export const __fileMetadata__ = {
  "id": 3,
  "name": "server-sdk-test",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

// Manual API Endpoint
// POST /api/v1/run/{script_name}
export default async function (req) {
    const data = await req.json()
    const apex = new ApexKit();
    const res = await apex.collection("docs").list({ per_page: 1 });
    // console.log(res)
    const body = await req.json();
    const profile = await apex.collection("profiles").get(data.user_id)//list({ filter: { user_id: data.user_id } });
    let embed = [];
    try {
        embed = await $ai.embed(data.name)
    } catch (err) {
        console.log(JSON.stringify(err))
    }
    return new Response({ embed, profile, message: "Hello!", res });
}