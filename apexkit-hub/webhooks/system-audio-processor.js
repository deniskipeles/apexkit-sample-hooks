export const __fileMetadata__ = {
  "id": 23,
  "name": "system-audio-processor",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "public"
};

/**
 * ApexKit Audio Processor v1.0
 * Specialized for Podcasts, Music, and Audio Extraction.
 * 
 * Capabilities:
 * - HLS/DASH Audio Streaming
 * - Cover Photo Baking (Static 1-fps video track for streaming, or ID3 tag for MP3/M4A)
 * - Auto-extract cover from video frame
 * - Bitrate compression and Format Conversion
 * 
 * @param {string} input_file - Filename in tenant uploads OR http(s) URL
 * @param {string} output_name - Desired name for output folder/file (no ext)
 * @param {string} [format="m4a"] - "m4a", "mp3", "ogg", "flac", "wav", "hls", "dash", "both"
 * @param {string} [bitrate="128k"] - Audio bitrate (e.g. "64k", "128k", "320k")
 * @param {string} [cover_image=null] - Path/URL to cover image to embed
 * @param {boolean} [extract_cover=false] - If input is video, extracts frame at 00:00:05 to use as cover
 * @param {object} [rclone=null] - Optional R2/S3 config
 */

export default async function (req) {
    const body = await req.json();

    const {
        input_file,
        output_name,
        format = "m4a",
        bitrate = "128k",
        cover_image = null,
        extract_cover = false,
        segment_time = 10, // Default 10s
        rclone = null
    } = body;

    let tenantId = "root_test";
    if (body.__caller_scope && body.__caller_scope.Tenant) {
        tenantId = body.__caller_scope.Tenant;
    } else if (body.tenant_id) {
        tenantId = body.tenant_id;
    }

    if (!input_file || !output_name)
        return new Response({ success: false, error: "Missing input_file or output_name" }, { status: 400 });

    const jobId = $util.uuid().split("-")[0];
    const jobChannel = tenantId === "root_test" ? `root::audio_${jobId}` : `tenant_${tenantId}::audio_${jobId}`;

    const localJobId = `audio_job_${jobId}`;
    const fsWorkDir = `${localJobId}`;
    const sysWorkDir = `storage/system/tmp/${localJobId}`;

    await $fs.mkdir(fsWorkDir);

    const inputPath = input_file.startsWith("http") ? input_file : `storage/tenants/${tenantId}/uploads/${input_file}`;

    let resolvedCoverPath = null;
    if (cover_image) {
        resolvedCoverPath = cover_image.startsWith("http") ? cover_image : `storage/tenants/${tenantId}/uploads/${cover_image}`;
    } else if (extract_cover) {
        resolvedCoverPath = `${sysWorkDir}/extracted_cover.jpg`;
    }

    let destSubPath = (format === 'hls' || format === 'dash' || format === 'both') ? output_name : '';
    let sysDestDir = tenantId === "root_test" ? `storage/tmp/root_test/${destSubPath}` : `storage/tenants/${tenantId}/tmp/${destSubPath}`;

    const isStreaming = format === "hls" || format === "dash" || format === "both";
    let args = [];

    let aCodec = "aac";
    if (format === "mp3") aCodec = "libmp3lame";
    else if (format === "ogg") aCodec = "libvorbis";
    else if (format === "flac") aCodec = "flac";
    else if (format === "wav") aCodec = "pcm_s16le";

    if (resolvedCoverPath && isStreaming) {
        // [FIX]: Force keyframe every N seconds.
        // If framerate is 1, then a keyframe every segment_time frames = exactly the segment duration.
        args.push(
            "-loop", "1", "-framerate", "1", "-i", resolvedCoverPath,
            "-i", inputPath,
            "-map", "0:v", "-map", "1:a",
            "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-pix_fmt", "yuv420p",
            // Force keyframes!
            "-g", segment_time.toString(), "-keyint_min", segment_time.toString(), "-sc_threshold", "0",
            "-shortest"
        );
    } else if (resolvedCoverPath && !isStreaming) {
        args.push("-i", inputPath, "-i", resolvedCoverPath, "-map", "0:a", "-map", "1:v", "-c:v", "copy", "-disposition:v", "attached_pic");
    } else {
        args.push("-i", inputPath, "-vn", "-map", "0:a");
    }

    args.push("-c:a", aCodec);
    if (format !== "flac" && format !== "wav") args.push("-b:a", bitrate);

    if (isStreaming) {
        const segmentExt = (aCodec === "aac") ? "m4s" : "ts";
        const segmentType = (aCodec === "aac") ? "fmp4" : "mpegts";

        if (format === "hls" || format === "both") {
            args.push(
                "-f", "hls",
                "-hls_time", segment_time.toString(),
                "-hls_segment_type", segmentType,
                "-hls_segment_filename", `${sysWorkDir}/hls/seg_%03d.${segmentExt}`,
                "-master_pl_name", "master.m3u8",
                "-hls_playlist_type", "vod",
                `${sysWorkDir}/hls/playlist.m3u8`
            );
        }

        if (format === "dash" || format === "both") {
            args.push(
                "-f", "dash",
                "-seg_duration", segment_time.toString(),
                "-streaming", "0",
                "-use_template", "1", "-use_timeline", "1",
                "-init_seg_name", "init_$RepresentationID$.mp4",
                "-media_seg_name", "chunk_$RepresentationID$_$Number$.m4s",
                `${sysWorkDir}/dash/manifest.mpd`
            );
        }
    } else {
        args.push(`${sysWorkDir}/${output_name}.${format}`);
    }

    const shellEscape = (arg) => "'" + arg.replace(/'/g, "'\\''") + "'";
    const escapedArgs = args.map(shellEscape);

    let extractCoverCmd = "";
    if (extract_cover && !cover_image) {
        extractCoverCmd = `
        echo "Extracting cover from video..." >&2
        ffmpeg -y -ss 00:00:05 -i '${inputPath.replace(/'/g, "'\\''")}' -vframes 1 -q:v 2 ${sysWorkDir}/extracted_cover.jpg >/dev/null 2>&1 || true
        `;
    }

    const rcloneConfigStr = rclone ? `[target]\ntype=s3\nprovider=${rclone.provider || "AWS"}\naccess_key_id=${rclone.access_key}\nsecret_access_key=${rclone.secret_key}\nregion=${rclone.region}\nendpoint=${rclone.endpoint || ""}\nacl=public-read` : "";

    let postProcessCmds = "";
    if (rclone) {
        postProcessCmds = `
            echo "Uploading to S3..." >&2
            if [ "${format}" = "hls" ] || [ "${format}" = "dash" ] || [ "${format}" = "both" ]; then
                rclone --config ${sysWorkDir}/rclone.conf copy ${sysWorkDir} target:${rclone.bucket}/${output_name} --exclude "rclone.conf" --exclude "ffmpeg.log" --exclude "proc.sh" --exclude "extracted_cover.jpg" >&2
            else
                FILENAME=$(ls ${sysWorkDir} | grep -vE 'proc.sh|rclone.conf|ffmpeg.log|extracted_cover.jpg' | head -n 1)
                rclone --config ${sysWorkDir}/rclone.conf copyto ${sysWorkDir}/$FILENAME target:${rclone.bucket}/${output_name}/${output_name}.${format} >&2
            fi
        `;
    } else {
        postProcessCmds = `
            echo "Moving to Tenant Storage..." >&2
            mkdir -p ${sysDestDir}
            cp -r ${sysWorkDir}/* ${sysDestDir}/
            rm -f ${sysDestDir}/ffmpeg.log ${sysDestDir}/proc.sh ${sysDestDir}/rclone.conf ${sysDestDir}/extracted_cover.jpg
        `;
    }

    const wrapperScript = `
        #!/bin/bash
        mkdir -p ${sysWorkDir}/hls ${sysWorkDir}/dash
        
        ${rclone ? `echo "${rcloneConfigStr}" > ${sysWorkDir}/rclone.conf` : ""}
        ${extractCoverCmd}
        
        echo "Starting Audio Encode..." >&2
        ffmpeg -y ${escapedArgs.join(" ")} 2>&1 | tr '\\r' '\\n' | tee -a ${sysWorkDir}/ffmpeg.log >&2
        
        if [ "\${PIPESTATUS[0]}" -eq 0 ]; then
            echo "Encode SUCCESS. Moving files..." >&2
            ${postProcessCmds}
            rm -rf ${sysWorkDir}
        else
            echo "Encode FAILED." >&2
            exit 1
        fi
    `;

    const wrapperPath = `${fsWorkDir}/proc.sh`;
    await $fs.write(wrapperPath, wrapperScript);
    await $cmd.run("chmod", ["+x", `storage/system/tmp/${wrapperPath}`]);

    const job = await $cmd.spawn("bash", [`storage/system/tmp/${wrapperPath}`], {
        timeout: 1800000,
        onProgress: {
            regex: ".*(time=[0-9:.]+|size=.*bitrate=.*).*",
            channel: jobChannel,
            event: "progress"
        }
    });

    return new Response({
        success: true,
        job_id: job.pid,
        status: job.status,
        channel: `audio_${jobId}`,
        outputs: isStreaming ? { hls: `${output_name}/hls/master.m3u8` } : { file: `${output_name}.${format}` }
    });
}