export const __fileMetadata__ = {
  "id": 27,
  "name": "send-mail",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "public"
};

/**
 * Sends a transactional email using the Brevo HTTP API.
 * This bypasses outbound SMTP port restrictions (like 587) by routing requests
 * over secure HTTPS (port 443), which is allowed in Hugging Face Spaces and Render.
 * 
 * @param {Request} req - The incoming HTTP Request object.
 * @param {Object} req.args - Request payload parameters automatically parsed.
 * @param {string} req.args.toEmail - The recipient's email address.
 * @param {string} [req.args.toName] - Optional recipient name.
 * @param {string} req.args.subject - The subject line of the email.
 * @param {string} req.args.htmlContent - The HTML content body of the email.
 * @param {string} [req.args.senderEmail] - Optional sender email (falls back to BREVO_SENDER_EMAIL env).
 * @param {string} [req.args.senderName] - Optional sender name (falls back to BREVO_SENDER_NAME env).
 * 
 * @returns {Promise<Response>} An HTTP Response object containing the Brevo API result.
 */
export default async function (req) {
  try {
    // Parse the incoming JSON body
    const body = await req.json();

    const toEmail = body.toEmail;
    const toName = body.toName;
    const subject = body.subject;
    const htmlContent = body.htmlContent;

    // Validate required parameters
    if (!toEmail || !subject || !htmlContent) {
      return new Response({
        error: "bad_request",
        message: "Missing required fields: 'toEmail', 'subject', or 'htmlContent'."
      }, { status: 400 });
    }

    // Retrieve credentials securely from the decrypted configuration registry ($env)
    const brevoApiKey = await $env.get("BREVO_API_KEY");
    const defaultSenderEmail = await $env.get("BREVO_SENDER_EMAIL");
    const defaultSenderName = await $env.get("BREVO_SENDER_NAME");

    if (!brevoApiKey) {
      console.log("Error: BREVO_API_KEY is missing in the system configuration ($env).");
      return new Response({
        error: "internal_error",
        message: "Mailer is misconfigured. BREVO_API_KEY is not defined in $env."
      }, { status: 500 });
    }

    const senderEmail = body.senderEmail || defaultSenderEmail || "noreply@localhost";
    const senderName = body.senderName || defaultSenderName || "ApexKit App";

    // Build the Brevo transaction payload
    const brevoPayload = {
      sender: {
        name: senderName,
        email: senderEmail
      },
      to: [
        {
          email: toEmail,
          name: toName
        }
      ],
      subject: subject,
      htmlContent: htmlContent
    };

    // Make the secure HTTP request to Brevo's SMTP API endpoint
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": brevoApiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify(brevoPayload)
    });

    const resData = await response.json();

    if (!response.ok) {
      console.log("Brevo API error: " + JSON.stringify(resData));
      console.log(JSON.stringify(response))
      return new Response({
        error: "upstream_error",
        message: "Failed to dispatch email via Brevo's API.",
        details: resData
      }, { status: response.status });
    }

    return new Response({
      success: true,
      message: "Email successfully dispatched.",
      messageId: resData.messageId
    }, { status: 200 });

  } catch (error) {
    console.log("Brevo Mailer Exception: " + error.toString());
    return new Response({
      error: "exception",
      message: error.toString()
    }, { status: 500 });
  }
}