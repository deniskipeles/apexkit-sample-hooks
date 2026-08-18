export const __fileMetadata__ = {
  "id": 12,
  "name": "provision-sandbox",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

/**
 * ApexKit Sandbox Provisioning Service
 * Script Name: provision-sandbox
 */
export default async function (req) {
    if (req.method !== "POST") {
        return new Response({ error: "Method Not Allowed. Use POST." }, { status: 405 });
    }

    // ---------------------------------------------------------
    // 1. SECURELY IDENTIFY USER
    // ---------------------------------------------------------
    let userId = req.auth ? req.auth.id : null;
    let userEmail = req.auth ? req.auth.email : null;

    if (!userId) {
        const authHeader = req.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return new Response({ error: "Unauthorized: Missing authorization header" }, { status: 401 });
        }

        try {
            const tokenParts = authHeader.split(" ")[1].split(".");
            if (tokenParts.length !== 3) {
                return new Response({ error: "Invalid Token format" }, { status: 401 });
            }

            const payloadStr = $util.base64Decode(tokenParts[1]);
            const claims = JSON.parse(payloadStr);

            userId = claims.uid;
            userEmail = claims.sub;
        } catch (e) {
            return new Response({ error: "Failed to parse JWT token" }, { status: 401 });
        }
    }

    if (!userId) {
        return new Response({ error: "Invalid User ID or Email in token" }, { status: 401 });
    }

    // ---------------------------------------------------------
    // 2. ENFORCE QUOTA (50MB Limit - Stringified Filter)
    // ---------------------------------------------------------
    const mySandboxesRes = await $db.records.list("sandbox_requests", {
        filter: JSON.stringify({ created_by: userId })
    });

    const mySandboxes = (mySandboxesRes && mySandboxesRes.items) ? mySandboxesRes.items : [];
    
    let totalUsageBytes = 0;
    const LIMIT_BYTES = 50 * 1024 * 1024; // 50 MB

    for (const sb of mySandboxes) {
        const sbId = sb.data ? (sb.data.sandbox_id || sb.data.id) : sb.id;
        if (sbId) {
            try {
                const size = await $root.getSandboxDiskUsage(sbId);
                totalUsageBytes += (size || 0);
            } catch (e) {}
        }
    }

    if (totalUsageBytes > LIMIT_BYTES) {
        const usedMB = (totalUsageBytes / 1024 / 1024).toFixed(2);
        return new Response({
            error: `Quota Exceeded. You are using ${usedMB}MB / 50MB across your sandboxes. Please delete old sessions.`
        }, { status: 403 });
    }

    // ---------------------------------------------------------
    // 3. PROVISION EMPTY ENVIRONMENT (clone_strategy: "none")
    // ---------------------------------------------------------
    const body = await req.json();
    const sandboxId = $util.uuid();

    console.log(`Provisioning EMPTY sandbox [${sandboxId}] for user ${userId}...`);

    try {
        await $root.createSandbox(sandboxId, {
            name: body.name || `Sandbox ${sandboxId.substring(0, 6)}`,
            owner_id: userId,
            clone_strategy: "none",
            expires_at: new Date(Date.now() + 86400000).toISOString()
        });

        // Sleep 10 seconds for Master-Replica sync if running on a replica
        console.log(`Waiting 10s for Master sync of Sandbox [${sandboxId}]...`);
        $util.sleep(10000);

    } catch (err) {
        console.log(`Sandbox creation encountered error/replica delay: ${err.toString()}`);
        $util.sleep(10000);

        // Dumb request ping to initialize replica
        try {
            const appUrl = $env.APP_URL || "http://127.0.0.1:5000";
            const pingUrl = `${appUrl}/sandbox/${sandboxId}/app-name`;
            console.log(`Sending dumb request to [${pingUrl}] to initialize replica...`);
            await $http.get(pingUrl);
        } catch (pingErr) {
            console.log(`Dumb ping request completed: ${pingErr.toString()}`);
        }
    }

    // ---------------------------------------------------------
    // 4. BOOTSTRAP DEFAULT & CUSTOM ADMIN USERS IN SANDBOX
    // ---------------------------------------------------------
    const sandboxContext = `sandbox:${sandboxId}`;

    try {
        // A. Default system admin
        await $root.db.users.create(
            sandboxContext,
            "sandbox-admin@apexkit.io",
            "password",
            "admin"
        );

        // B. Logged-in JWT user
        if (userEmail && userEmail !== "sandbox-admin@apexkit.io") {
            await $root.db.users.create(
                sandboxContext,
                userEmail,
                "password",
                "admin"
            );
        }

        // C. Custom user credentials provided in request body
        const customEmail = body.admin_email || body.email;
        const customPassword = body.admin_password || body.password;

        if (customEmail && customPassword) {
            await $root.db.users.create(
                sandboxContext,
                customEmail,
                customPassword,
                "admin"
            );
            console.log(`Created custom admin user [${customEmail}] inside sandbox [${sandboxId}]`);
        }

        console.log(`Successfully initialized admin users inside sandbox [${sandboxId}]`);
    } catch (err) {
        console.log(`Warning: Failed to create default admin in sandbox: ${err.toString()}`);
    }

    return new Response({
        success: true,
        sandbox_id: sandboxId,
        quota_usage_mb: (totalUsageBytes / 1024 / 1024).toFixed(2)
    });
}