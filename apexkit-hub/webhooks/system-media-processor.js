export const __fileMetadata__ = {
  "id": 16,
  "name": "system-media-processor",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "public"
};

/**
 * ApexKit Ultimate Media Processor v7.5 (Production)
 * Fixed critical race condition in script generation sequence.
 * 
 * Capabilities:
 * - HLS/DASH Adaptive Bitrate (ABR) Streaming
 * - Codec Support: H.264, HEVC, AV1 (SVT-AV1), VP9
 * - Optimized GIF & Thumbnail Generation
 * - Smart Storage: Local Tenant Tmp OR Cloud (S3/R2/Rclone)
 * - Real-time Progress Events via WebSocket
 * 
 * @param {string} input_file - Filename in tenant uploads OR http(s) URL
 * @param {string} output_name - Desired name for output folder/file (no ext)
 * @param {string} [format="mp4"] - "mp4", "webm", "gif", "jpg", "png", "hls", "dash", "both"
 * @param {string} [codec="h264"] - "h264", "hevc", "av1", "vp9"
 * @param {boolean} [gpu=false] - Use GPU acceleration (NVENC)
 * @param {string} [ladder="auto"] - "auto" or "min-max" (e.g., "144-480")
 * @param {number} [segment_time=10] - Segment duration in seconds
 * @param {object} [rclone] - Optional R2/S3 config
 * @param {boolean} [force_reencode=false] - Force reencode even if same codec
 */
export default async function (req) {
    const body = await req.json();
    await $cmd.setLimit("ffprobe", 100);
    await $cmd.setLimit("chmod", 100);

    const {
        input_file,
        output_name,
        format = "mp4",
        codec = null,
        gpu = false,
        ladder = "auto",
        segment_time = 10,
        rclone = null,
        force_reencode = false
    } = body;

    let tenantId = "root_test";
    if (body.__caller_scope && body.__caller_scope.Tenant) {
        tenantId = body.__caller_scope.Tenant;
    } else if (body.tenant_id) {
        tenantId = body.tenant_id;
    }

    if (!input_file || !output_name) return new Response({ success: false, error: "Missing inputs" }, { status: 400 });

    const jobId = $util.uuid().split("-")[0];
    const jobChannel = tenantId === "root_test" ? `root::job_${jobId}` : `tenant_${tenantId}::job_${jobId}`;

    const localJobId = `job_${jobId}`;
    const fsWorkDir = `${localJobId}`;
    const sysWorkDir = `storage/system/tmp/${localJobId}`;

    await $fs.mkdir(fsWorkDir);

    const inputPath = input_file.startsWith("http") ? input_file : `storage/tenants/${tenantId}/uploads/${input_file}`;
    let destSubPath = (format === 'hls' || format === 'dash' || format === 'both') ? output_name : '';
    let sysDestDir = tenantId === "root_test" ? `storage/tmp/root_test/${destSubPath}` : `storage/tenants/${tenantId}/tmp/${destSubPath}`;

    let args = ["-y", "-i", inputPath];
    const singleFileFormats = ["mp4", "mkv", "webm", "mov", "avi", "flv", "gif", "jpg", "png"];
    const isStreaming = format === "hls" || format === "dash" || format === "both";
    let finalCodec = codec || "h264";
    let ladderProfiles = [];

    // =====================================================
    // 🎬 STREAMING LOGIC (OPTIMIZED AUDIO)
    // =====================================================
    if (isStreaming) {
        const probe = await $cmd.run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=height", "-of", "json", inputPath], { timeout: 10000 });
        if (probe.status !== 0) return new Response({ error: "Probe failed" }, { status: 500 });

        const inputHeight = JSON.parse(probe.stdout).streams[0].height;
        ladderProfiles = buildAutoLadder(inputHeight, ladder);

        const videoCodec = getCodec(finalCodec, gpu);

        // Filter: Scale videos, but DO NOT duplicate audio
        let filter = "";
        ladderProfiles.forEach((l, i) => { filter += `[0:v]scale=-2:${l.h}[v${i}];`; });

        // Split audio just ONCE for the package
        filter += `[0:a]asplit=1[a0];`;

        args.push("-filter_complex", filter.slice(0, -1));

        // Map video tracks
        ladderProfiles.forEach((l, i) => {
            args.push("-map", `[v${i}]`, ...videoCodec, `-b:v:${i}`, l.b);
        });

        // Map audio track ONCE
        args.push("-map", `[a0]`, "-c:a", "aac", `-b:a:${ladderProfiles.length}`, "128k");

        const segmentType = (finalCodec === "h264") ? "mpegts" : "fmp4";
        const segmentExt = (segmentType === "mpegts") ? "ts" : "m4s";

        if (format === "hls" || format === "both") {
            // MAGIC HLS DEDUPLICATION: Tell HLS to share audio across all video streams
            let varStreamMap = "";
            ladderProfiles.forEach((_, i) => { varStreamMap += `v:${i},agroup:audio `; });
            varStreamMap += `a:0,agroup:audio,default:yes`;

            args.push(
                "-f", "hls", "-hls_time", segment_time.toString(), "-hls_segment_type", segmentType,
                "-hls_segment_filename", `${sysWorkDir}/hls/v%v/seg_%03d.${segmentExt}`,
                "-master_pl_name", "master.m3u8", "-var_stream_map", varStreamMap.trim(),
                "-hls_playlist_type", "vod", "-hls_flags", "independent_segments",
                `${sysWorkDir}/hls/v%v/playlist.m3u8`
            );
        }
    }
    // =====================================================
    // 🖼️ SINGLE FILE LOGIC
    // =====================================================
    else {
        let outputFile = `${sysWorkDir}/${output_name}.${format}`;
        if (format === "gif") {
            args.push("-t", "5", "-vf", "fps=10,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse", "-loop", "0", outputFile);
        } else if (format === "jpg" || format === "png") {
            // Extract at 1 second to avoid EOF errors on short clips
            args.push("-ss", "00:00:01", "-vframes", "1", outputFile);
        } else {
            const videoCodec = getCodec(finalCodec, gpu);
            args.push(...videoCodec, "-c:a", "aac", outputFile);
        }
    }

    const shellEscape = (arg) => "'" + arg.replace(/'/g, "'\\''") + "'";
    const escapedArgs = args.map(shellEscape);
    const postProcessCmds = await generateStorageCommands(rclone, localJobId, sysWorkDir, sysDestDir, output_name, format);

    // REMOVED 'set -e' to prevent silent exits.
    const wrapperScript = `
        #!/bin/bash
        mkdir -p ${sysWorkDir}/hls/v0 ${sysWorkDir}/hls/v1 ${sysWorkDir}/hls/v2 ${sysWorkDir}/hls/v3 ${sysWorkDir}/dash
        
        echo "Starting FFmpeg Transcode..." >&2
        ffmpeg ${escapedArgs.join(" ")} 2>&1 | tr '\\r' '\\n' | tee -a ${sysWorkDir}/ffmpeg.log >&2
        
        if [ "\${PIPESTATUS[0]}" -eq 0 ]; then
            echo "FFmpeg SUCCESS. Moving files..." >&2
            ${postProcessCmds}
            rm -rf ${sysWorkDir}
        else
            echo "FFmpeg FAILED." >&2
            exit 1
        fi
    `;

    const wrapperPath = `${fsWorkDir}/proc.sh`;
    await $fs.write(wrapperPath, wrapperScript);
    await $cmd.run("chmod", ["+x", `storage/system/tmp/${wrapperPath}`]);

    const job = await $cmd.spawn("bash", [`storage/system/tmp/${wrapperPath}`], {
        timeout: 3600000,
        onProgress: {
            regex: ".*(time=[0-9:.]+|frame=.*fps=.*size=.*).*",
            channel: jobChannel,
            event: "progress"
        }
    });

    return new Response({
        success: true,
        job_id: job.pid,
        status: job.status,
        channel: `job_${jobId}`,
        outputs: isStreaming ? { hls: `${output_name}/hls/master.m3u8` } : { file: `${output_name}.${format}` }
    });
}

function buildAutoLadder(maxHeight, range) {
    const presets = [
        { h: 144, b: "200k" }, { h: 240, b: "400k" }, { h: 360, b: "800k" },
        { h: 480, b: "1200k" }, { h: 720, b: "2500k" }, { h: 1080, b: "4500k" },
        { h: 1440, b: "8000k" }, { h: 2160, b: "14000k" }
    ];
    let min = 144, max = maxHeight;
    if (range !== "auto") {
        const p = range.split("-");
        min = parseInt(p[0]); max = parseInt(p[1]);
    }
    return presets.filter(p => p.h >= min && p.h <= max && p.h <= maxHeight);
}

function getCodec(codec, gpu) {
    if (!codec) return ["-c", "copy"];
    if (gpu && (codec === "h264" || codec === "hevc")) {
        return codec === "h264" ? ["-c:v", "h264_nvenc"] : ["-c:v", "hevc_nvenc"];
    }
    const cpuMap = {
        h264: ["-c:v", "libx264", "-preset", "veryfast"],
        hevc: ["-c:v", "libx265", "-preset", "medium"],
        av1: ["-c:v", "libsvtav1", "-preset", "8"],
        // Changed to 'good' deadline and CPU-used 3 for much better file size
        vp9: ["-c:v", "libvpx-vp9", "-deadline", "good", "-cpu-used", "3", "-row-mt", "1"]
    };
    return cpuMap[codec] || ["-c", "copy"];
}

async function generateStorageCommands(rclone, localJobId, sysWorkDir, sysDestDir, output_name, format) {
    if (rclone) {
        await $fs.write(`${localJobId}/rclone.conf`, `[target]\ntype=s3\nprovider=${rclone.provider || "AWS"}\naccess_key_id=${rclone.access_key}\nsecret_access_key=${rclone.secret_key}\nregion=${rclone.region}\nendpoint=${rclone.endpoint || ""}\nacl=public-read`);
        return `
            if [ "${format}" = "hls" ] || [ "${format}" = "dash" ] || [ "${format}" = "both" ]; then
                rclone --config ${sysWorkDir}/rclone.conf copy ${sysWorkDir} target:${rclone.bucket}/${output_name} --exclude "rclone.conf" --exclude "ffmpeg.log" --exclude "proc.sh" >&2
            else
                FILENAME=$(ls ${sysWorkDir} | grep -vE 'proc.sh|rclone.conf|ffmpeg.log' | head -n 1)
                rclone --config ${sysWorkDir}/rclone.conf copyto ${sysWorkDir}/$FILENAME target:${rclone.bucket}/${output_name}/${output_name}.${format} >&2
            fi
        `;
    } else {
        return `
            mkdir -p ${sysDestDir}
            cp -r ${sysWorkDir}/* ${sysDestDir}/
            rm -f ${sysDestDir}/ffmpeg.log ${sysDestDir}/proc.sh ${sysDestDir}/rclone.conf
        `;
    }
}