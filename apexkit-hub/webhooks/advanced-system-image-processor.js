export const __fileMetadata__ = {
  "id": 24,
  "name": "advanced-system-image-processor",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "public"
};

/**
 * ApexKit Ultimate Image Processor v1.0
 * 
 * Pipeline Execution Order:
 * 1. AI Upscale (if requested)
 * 2. AI Background Removal (if requested)
 * 3. ImageMagick Processing (Resize, Crop, Watermark, Format)
 * 
 * @param {string} input_file - Filename in tenant uploads OR http(s) URL
 * @param {string} output_name - Desired output filename stem
 * @param {string} [format="webp"] - "webp", "jpg", "png", "avif"
 * @param {object} [ops] - Dictionary of operations
 * @param {boolean} [ops.remove_bg=false] - AI Background removal (rembg)
 * @param {boolean} [ops.upscale=false] - AI Upscale 4x (realesrgan)
 * @param {object} [ops.resize] - { w: 800, h: 800, fit: "cover"|"contain" }
 * @param {number} [ops.blur=0] - Gaussian blur radius
 * @param {object} [rclone=null] - S3 upload config
 */
export default async function (req) {
    const body = await req.json();

    const {
        input_file,
        output_name,
        format = "webp",
        ops = {},
        rclone = null
    } = body;

    // 1. Resolve Tenant Scope
    let tenantId = "root_test";
    if (body.__caller_scope && body.__caller_scope.Tenant) {
        tenantId = body.__caller_scope.Tenant;
    } else if (body.tenant_id) {
        tenantId = body.tenant_id;
    }

    if (!input_file || !output_name)
        return new Response({ success: false, error: "Missing input_file or output_name" }, { status: 400 });

    const jobId = $util.uuid().split("-")[0];
    const jobChannel = tenantId === "root_test" ? `root::img_${jobId}` : `tenant_${tenantId}::img_${jobId}`;

    const localJobId = `img_job_${jobId}`;
    const fsWorkDir = `${localJobId}`;
    const sysWorkDir = `storage/system/tmp/${localJobId}`;

    await $fs.mkdir(fsWorkDir);

    const inputPath = input_file.startsWith("http") ? input_file : `storage/tenants/${tenantId}/uploads/${input_file}`;
    let sysDestDir = tenantId === "root_test" ? `storage/tmp/root_test` : `storage/tenants/${tenantId}/tmp`;

    const finalOutput = `${output_name}.${format}`;

    // =====================================================
    // 🛠️ BUILD PIPELINE SCRIPT WITH LOGGING
    // =====================================================

    let pipeline = `
#!/bin/bash
# Ensure Python bins and local bins are in PATH
export PATH=$PATH:$HOME/.local/bin:/usr/local/bin:/opt/bin

LOG_FILE="${sysWorkDir}/process.log"
DEST_DIR="${sysDestDir}"
FINAL_OUTPUT="${finalOutput}"

# Cleanup Trap: Always runs on exit (success or fail)
cleanup() {
    EXIT_CODE=$?
    mkdir -p "$DEST_DIR"
    
    # Always save the log file for debugging
    cp "$LOG_FILE" "$DEST_DIR/${localJobId}_debug.log"
    
    if [ $EXIT_CODE -ne 0 ]; then
        echo "Pipeline FAILED. Check log: $DEST_DIR/${localJobId}_debug.log" >&2
    else
        echo "Pipeline SUCCESS." >&2
    fi
    
    rm -rf "${sysWorkDir}"
    exit $EXIT_CODE
}

trap cleanup EXIT

# Run operations in a subshell, exit on error (-e), and print commands (-x)
(
    set -ex
    echo "Starting Image Pipeline..."
    
    # 1. Detect ImageMagick Command
    if command -v magick >/dev/null 2>&1; then
        IM_CMD="magick"
    elif command -v convert >/dev/null 2>&1; then
        IM_CMD="convert"
    else
        echo "ERROR: ImageMagick not found!"
        exit 1
    fi

    # 2. Get Input File
    CURRENT_FILE="${sysWorkDir}/input_raw"
    if [[ "${inputPath}" == http* ]]; then
        curl -sL "${inputPath}" -o "$CURRENT_FILE"
    else
        cp "${inputPath}" "$CURRENT_FILE"
    fi
    `;

    // --- STEP 1: AI UPSCALE ---
    if (ops.upscale) {
        pipeline += `
    echo "Processing: AI Fast Upscale (4x)..."
    # Using the tiny 'animevideov3' model which is already installed and lightning fast
    realesrgan-ncnn-vulkan -i "$CURRENT_FILE" -o "${sysWorkDir}/upscaled.png" -n realesr-animevideov3-x4 -s 4 -j 4:4 -m models
    CURRENT_FILE="${sysWorkDir}/upscaled.png"
        `;
    }

    // --- STEP 2: AI BACKGROUND REMOVAL ---
    if (ops.remove_bg) {
        pipeline += `
    echo "Processing: AI Background Removal..."
    rembg i "$CURRENT_FILE" "${sysWorkDir}/nobg.png"
    CURRENT_FILE="${sysWorkDir}/nobg.png"
        `;
    }

    // --- STEP 3: IMAGEMAGICK (Resize, Crop, Format) ---
    let imArgs = ["\"$IM_CMD\"", "\"$CURRENT_FILE\""];

    // Force ImageMagick to use a transparent canvas for any padding/cropping
    imArgs.push("-background", "transparent");

    if (ops.resize) {
        const w = ops.resize.w || '';
        const h = ops.resize.h || '';
        const fit = ops.resize.fit || 'contain';

        if (fit === 'cover' && w && h) {
            imArgs.push("-resize", `"${w}x${h}^"`, "-gravity", "center", "-extent", `"${w}x${h}"`);
        } else if (fit === 'fill') {
            imArgs.push("-resize", `"${w}x${h}!"`);
        } else {
            imArgs.push("-resize", `"${w}x${h}"`);
        }
    }

    if (ops.blur) imArgs.push("-blur", `"0x${ops.blur}"`);

    imArgs.push("-strip");
    imArgs.push("-quality", (ops.quality || 85).toString());
    imArgs.push(`"${sysWorkDir}/${finalOutput}"`);

    pipeline += `
    echo "Processing: Image Formatting..."
    ${imArgs.join(" ")}
    `;

    // --- STEP 4: STORAGE ROUTING ---
    if (rclone) {
        const conf = `[target]\ntype=s3\nprovider=${rclone.provider || "AWS"}\naccess_key_id=${rclone.access_key}\nsecret_access_key=${rclone.secret_key}\nregion=${rclone.region}\nendpoint=${rclone.endpoint || ""}\nacl=public-read`;
        await $fs.write(`${localJobId}/rclone.conf`, conf);

        pipeline += `
    echo "Uploading to S3..."
    rclone --config ${sysWorkDir}/rclone.conf copyto ${sysWorkDir}/${finalOutput} target:${rclone.bucket}/${finalOutput}
        `;
    } else {
        pipeline += `
    echo "Moving to Tenant Storage..."
    mv ${sysWorkDir}/${finalOutput} $DEST_DIR/
        `;
    }

    pipeline += `
) 2>&1 | tee "$LOG_FILE" >&2
    `;

    // Write and Execute
    const wrapperPath = `${fsWorkDir}/proc.sh`;
    await $fs.write(wrapperPath, pipeline);
    await $cmd.run("chmod", ["+x", `storage/system/tmp/${wrapperPath}`]);

    const job = await $cmd.spawn("bash", [`storage/system/tmp/${wrapperPath}`], {
        timeout: 180000, // 2 mins max
        onProgress: {
            regex: "^Processing: (.*)",
            channel: jobChannel,
            event: "progress"
        }
    });

    return new Response({
        success: true,
        job_id: job.pid,
        status: job.status,
        channel: `img_${jobId}`,
        output: finalOutput
    });
}