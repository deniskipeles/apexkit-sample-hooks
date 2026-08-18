export const __fileMetadata__ = {
  "id": 20,
  "name": "test-file-url",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

// Example Script
export default async function(req) {
    // Generate a URL valid for 60 seconds
    const directUrl = await $files.getSignedUrl("7fa6e723-710f-4eb3-acd4-3bed8258d3eb.png", 60);
    
    return new Response({ 
        url: directUrl,
        note: "This link expires in 1 minute" 
    });
}