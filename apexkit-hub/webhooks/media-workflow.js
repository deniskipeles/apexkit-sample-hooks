export const __fileMetadata__ = {
  "id": 17,
  "name": "media-workflow",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

export default async function (req) {
    // Public video URL for testing
    const videoUrl = "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
    const baseName = "bunny";

    // 1. Generate Thumbnail (JPG)
    const jobThumb = await $run.script("system-media-processor", {
        input_file: videoUrl,
        output_name: baseName,
        format: "jpg"
    });

    // If not, let's generate a GIF as preview
    const jobGif = await $run.script("system-media-processor", {
        input_file: videoUrl,
        output_name: baseName,
        format: "gif",
        quality: "low" // Small gif
    });

    // 2. Generate HLS Stream
    const jobHls = await $run.script("system-media-processor", {
        input_file: videoUrl,
        output_name: baseName,
        format: "hls",
        options: { segment_time: 4 }
    });

    return new Response({
        message: "Workflow started",
        jobs: {
            gif: jobGif,
            hls: jobHls,
            jpg: jobThumb
        }
    });
}