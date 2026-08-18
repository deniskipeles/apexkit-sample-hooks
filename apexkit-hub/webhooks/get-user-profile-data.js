export const __fileMetadata__ = {
  "id": 29,
  "name": "get-user-profile-data",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

/**
 * ApexKit Profile Data Service
 * Script Name: get-user-profile-data
 */
export default async function (req) {
    // ---------------------------------------------------------
    // 1. SECURELY IDENTIFY USER
    // ---------------------------------------------------------
    let userId = req.auth ? req.auth.id : null;
    let userEmail = req.auth ? req.auth.email : null;
    let userRole = req.auth ? req.auth.role : null;

    if (!userId) {
        const authHeader = req.headers.get("authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
            try {
                const tokenParts = authHeader.split(" ")[1].split(".");
                if (tokenParts.length === 3) {
                    const payloadStr = $util.base64Decode(tokenParts[1]);
                    const claims = JSON.parse(payloadStr);
                    userId = claims.uid;
                    userEmail = claims.sub;
                    userRole = claims.role;
                }
            } catch (e) {}
        }
    }

    if (!userId) {
        return new Response({ error: "Unauthorized: Invalid or missing authentication token" }, { status: 401 });
    }

    // ---------------------------------------------------------
    // 2. FETCH TENANTS FROM `tenant_registry` (STRINGIFIED FILTER)
    // ---------------------------------------------------------
    const registryRes = await $db.records.list("tenant_registry", {
        filter: JSON.stringify({ owner_id: userId })
    });

    const tenants = (registryRes && registryRes.items) ? registryRes.items : [];

    // Extract tenant_ids owned by this user
    const userTenantIds = tenants
        .map(t => {
            if (!t) return null;
            return t.tenant_id || (t.data ? t.data.tenant_id : null) || t.id;
        })
        .filter(id => id !== null && id !== undefined);

    // ---------------------------------------------------------
    // 3. FETCH & FILTER API KEYS FOR USER'S TENANTS ONLY
    // ---------------------------------------------------------
    let userKeys = [];
    try {
        let allKeys = [];
        if ($root && typeof $root.listKeys === "function") {
            allKeys = await $root.listKeys();
        }

        if (Array.isArray(allKeys)) {
            // Filter: Return keys where tenant_id matches one of the user's tenants,
            // or root keys if user is a Root Administrator.
            userKeys = allKeys.filter(k => {
                if (!k) return false;
                if (userRole === "admin" && (k.tenant_id === "root" || k.issuer === "root")) {
                    return true;
                }
                return userTenantIds.includes(k.tenant_id);
            });
        }
    } catch (e) {
        console.log("Key filtering warning: " + e.toString());
    }

    return new Response({
        success: true,
        user: { id: userId, email: userEmail, role: userRole },
        tenants: tenants,
        keys: userKeys
    });
}