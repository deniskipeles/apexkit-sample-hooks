export const __fileMetadata__ = {
  "id": 1,
  "name": "create-profile-on-register",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "after_user_create",
  "active": true,
  "visibility": "private"
};

/** @type {import("../apexkit").FileMetadata} */


/**
 * Hook: after_user_create
 * 
 * @param {import("../apexkit").VoidHookEvent} event - data contains { id, email, role }
 */
export default async function (event) {
  const user = event.data;
  console.log(`[Auth] New user registered: ${user.email} (ID: ${user.id})`);

  // ApexKit passes the newly created user inside the `data` property 
  // Format: { "id": 1, "email": "test@...", "role": "user" }
  const newUser = user;

  try {
    // 2. Create the corresponding Profile record
    await $db.records.create("profiles", {
      user_id: newUser.id,
      metadata: {
        email: newUser.email,
        role: newUser.role,
        display_name: newUser.email.split('@')[0],
        created_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.log(JSON.stringify(error))
  }
}