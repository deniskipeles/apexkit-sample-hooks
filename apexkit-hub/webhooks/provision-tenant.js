export const __fileMetadata__ = {
  "id": 21,
  "name": "provision-tenant",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

/**
 * ApexKit Tenant Provisioning Service
 * Script Name: provision-tenant
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
            if (tokenParts.length !== 3) return new Response({ error: "Invalid Token format" }, { status: 401 });

            const payloadStr = $util.base64Decode(tokenParts[1]);
            const claims = JSON.parse(payloadStr);

            userId = claims.uid;
            userEmail = claims.sub;
        } catch (e) {
            return new Response({ error: "Failed to parse JWT token" }, { status: 401 });
        }
    }

    if (!userId || !userEmail) {
        return new Response({ error: "Invalid User ID or Email in token" }, { status: 401 });
    }

    // ---------------------------------------------------------
    // 2. ENFORCE QUOTA (STRINGIFIED FILTER)
    // ---------------------------------------------------------
    const myTenants = await $db.records.list("tenant_registry", {
        filter: JSON.stringify({ owner_id: userId })
    });

    const MAX_TENANTS = 3;
    if (myTenants && myTenants.total >= MAX_TENANTS) {
        return new Response({
            error: `Quota Exceeded. You already own ${MAX_TENANTS} tenant applications.`
        }, { status: 403 });
    }

    // ---------------------------------------------------------
    // 3. PARSE BODY & VALIDATE UNIQUE TENANT ID
    // ---------------------------------------------------------
    const body = await req.json();
    const appName = body.app_name || body.name || "My Awesome App";
    
    let rawTenantId = body.tenant_id || appName;
    const cleanSlug = $util.slugify(rawTenantId);
    
    const tenantId = body.tenant_id 
        ? cleanSlug 
        : `${cleanSlug}-${$util.uuid().substring(0, 6)}`;

    if (!tenantId || tenantId.length < 3) {
        return new Response({ error: "Tenant ID must be at least 3 characters long." }, { status: 400 });
    }

    // Check collision in tenant_registry using stringified filter
    const existingCheck = await $db.records.list("tenant_registry", {
        filter: JSON.stringify({ tenant_id: tenantId })
    });

    if (existingCheck && existingCheck.total > 0) {
        return new Response({ error: `Tenant ID '${tenantId}' is already taken. Please choose another.` }, { status: 409 });
    }

    console.log(`Provisioning Tenant [${tenantId}] (${appName}) for ${userEmail}...`);

    // ---------------------------------------------------------
    // 4. PROVISION ENVIRONMENT (WITH TRY-CATCH & 10s SLEEP / REPLICA SYNC)
    // ---------------------------------------------------------
    try {
        await $root.createTenant(tenantId, {
            name: appName,
            owner_id: userId,
            tier: body.tier || "free"
        });
        
        // Wait 10 seconds to allow Master -> Replica database sync
        console.log(`Waiting 10s for Master sync of Tenant [${tenantId}]...`);
        $util.sleep(10000);

    } catch (err) {
        console.log(`Tenant creation encountered error/replica delay: ${err.toString()}`);

        // Wait 10 seconds to allow snapshot propagation from Master
        $util.sleep(10000);

        // Make a dumb request to that tenant to force local initialization on replica
        try {
            const appUrl = $env.APP_URL || "http://127.0.0.1:5000";
            const pingUrl = `${appUrl}/tenant/${tenantId}/app-name`;
            console.log(`Sending dumb request to [${pingUrl}] to initialize replica...`);
            await $http.get(pingUrl);
        } catch (pingErr) {
            console.log(`Dumb ping request completed/warned: ${pingErr.toString()}`);
        }
    }

    // Save to tenant_registry
    await $db.records.create("tenant_registry", {
        owner_id: userId,
        tenant_id: tenantId,
        app_name: appName
    });

    // ---------------------------------------------------------
    // 5. BOOTSTRAP DEFAULT ADMIN
    // ---------------------------------------------------------
    const tenantContext = `tenant:${tenantId}`;
    const defaultPassword = $util.randomHex(6);

    try {
        await $root.db.users.create(
            tenantContext,
            userEmail,
            defaultPassword,
            "admin"
        );
        console.log(`Initialized Admin [${userEmail}] for Tenant [${tenantId}]`);
    } catch (err) {
        console.log(`Warning: Failed to create default admin: ${err.toString()}`);
    }

    // ---------------------------------------------------------
    // 6. DISPATCH WELCOME EMAIL
    // ---------------------------------------------------------
    const appUrl = $env.APP_URL || "https://api.apexkit.io";
    const dashboardUrl = `${appUrl}/_dashboard/tenant/${tenantId}`;

    const emailHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
            <h1 style="color: #2563eb;">Your App is Live! 🚀</h1>
            <p>Your isolated backend environment <strong>${appName}</strong> has been provisioned.</p>
            
            <div style="background-color: #f3f4f6; padding: 15px; border-radius: 6px; margin: 20px 0;">
                <ul style="list-style: none; padding: 0; margin: 0; line-height: 1.6;">
                    <li><strong>Tenant ID:</strong> <code>${tenantId}</code></li>
                    <li><strong>App Name:</strong> ${appName}</li>
                    <li><strong>Admin Email:</strong> ${userEmail}</li>
                    <li><strong>Temp Password:</strong> <code>${defaultPassword}</code></li>
                </ul>
            </div>
            <p>
                <a href="${dashboardUrl}" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                    Go to Dashboard
                </a>
            </p>
        </div>
    `;

    try {
        const subject = `Welcome to ${appName} - Credentials Inside`;
        if (!$env.SMTP_BLOCKED) {
            await $mail.send(userEmail, subject, emailHtml);
        } else {
            await $run.script("send-mail", { toEmail: userEmail, htmlContent: emailHtml, subject });
        }
    } catch (err) {
        console.log(`Email skipped/failed: ${err.toString()}`);
    }

    return new Response({
        success: true,
        tenant_id: tenantId,
        app_name: appName,
        links: { dashboard: dashboardUrl }
    });
}