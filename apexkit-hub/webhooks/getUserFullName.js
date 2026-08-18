export const __fileMetadata__ = {
  "id": 5,
  "name": "getUserFullName",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "graphql",
  "active": true,
  "visibility": "private"
};

export const graphql = {
    parent: "User",
    name: "fullName",
    args: {},
    returnType: "String"
};

export default async function (req) {
    const user = req.args.parent;
    console.log(JSON.stringify(user))
    // --- DEBUGGING STEP ---
    // If this is the admin user, dump the first 3 profiles so we can see the field names and types.
    if (user.role === 'admin') {
        console.log(`\n--- DEBUG: DUMPING PROFILES COLLECTION ---`);
        const all = await $apex.collection("profiles").list({ limit: 3 });
        if (all.items.length === 0) {
            console.log("Collection 'profiles' is EMPTY!");
        } else {
            console.log(JSON.stringify(all.items[0].data, null, 2));
        }
        console.log(`------------------------------------------\n`);
    }
    // ----------------------

    // Try converting ID to String (Common fix for JSON databases)
    const filterObj = { user_id: String(user.id) }; 
    
    const data = await $apex.collection("profiles").list({ 
        filter: JSON.stringify(filterObj),
        limit: 1 
    });

    const profile = data.items.length ? data.items[0]?.data : null;
    return profile ? `${profile.first_name} ${profile.last_name}` : "Unknown";
}