export const __fileMetadata__ = {
  "id": 28,
  "name": "update-tenant-limits",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

export default async function (req) {
    // Only accept POST requests
    if (req.method !== "POST") {
        return new Response({ error: "Method Not Allowed" }, { status: 405 });
    }
    if (req.auth.role !== "admin") {
        return new Response({ error: "User Not Allowed" }, { status: 405 });
    }

    const body = await req.json();

    if (!body.tenant_id || !body.max_vectors) {
        return new Response({ error: "tenant_id and max_vectors are required" }, { status: 400 });
    }

    try {
        // Uses the Root API to update the tenant
        await $root.updateTenant(body.tenant_id, { max_vectors: body.max_vectors });

        return new Response({
            success: true,
            message: `Tenant ${body.tenant_id} limit successfully updated to ${body.max_vectors}`
        }, { status: 200 });

    } catch (e) {
        return new Response({ error: e.toString() }, { status: 500 });
    }
}