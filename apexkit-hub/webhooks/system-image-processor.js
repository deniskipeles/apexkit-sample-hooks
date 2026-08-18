export const __fileMetadata__ = {
  "id": 19,
  "name": "system-image-processor",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "public"
};

/**
 * ApexKit Ultimate Image Processor
 * Wraps ImageMagick (magick) for advanced image manipulation.
 * 
 * @payload {string} input_file - Filename in tenant uploads OR http URL.
 * @payload {string} output_name - Desired output filename stem.
 * @payload {string} [format="webp"] - Output format.
 * @payload {object} [ops] - Operations config.
 * @payload {object} [ops.resize] - { width, height, fit: "cover"|"contain"|"fill" }
 * @payload {object} [ops.watermark] - { file: "logo.png", gravity: "southeast", opacity: 30, scale: 20 }
 * @payload {number} [quality=85] - Compression quality (1-100).
 */
export default async function (req) {
    const body = await req.json();
    const {
        input_file,
        output_name,
        format = "webp",
        ops = {},
        quality = 85,
        rclone
    } = body;

    // 1. Resolve Tenant Scope
    let tenantId = "root_test";
    if (body.__caller_scope && body.__caller_scope.Tenant) {
        tenantId = body.__caller_scope.Tenant;
    } else if (body.tenant_id) {
        tenantId = body.tenant_id;
    }

    const jobId = $util.uuid().split('-')[0];
    const fsWorkDir = `./img_job_${jobId}`;
    const sysWorkDir = `storage/system/tmp/img_job_${jobId}`;

    console.log(`[Image] Job ${jobId} for Tenant ${tenantId}`);

    // 2. Resolve Input
    let sysInputPath = input_file;
    if (!input_file.startsWith("http")) {
        sysInputPath = `storage/tenants/${tenantId}/uploads/${input_file}`;
        // Note: Watermark file path logic below assumes tenant upload too
    }

    // 3. Prepare Command Arguments
    // We use "magick" (IM v7) syntax
    let args = [sysInputPath];

    // --- OPERATIONS ---

    // Resize
    if (ops.resize) {
        const { width, height, fit = "cover" } = ops.resize;
        let geo = `${width || ''}x${height || ''}`;

        if (fit === "cover") geo += "^";   // Fill area, crop needed later?
        else if (fit === "contain") geo += ""; // Default
        else if (fit === "fill") geo += "!";   // Stretch
        else if (fit === "limit") geo += ">";  // Shrink only

        args.push("-resize", geo);

        if (fit === "cover" && width && height) {
            // Smart center crop after resize
            args.push("-gravity", "center", "-extent", `${width}x${height}`);
        }
    }

    // Rotate
    if (ops.rotate) {
        args.push("-rotate", ops.rotate.toString());
    }

    // Effects
    if (ops.blur) args.push("-blur", `0x${ops.blur}`);
    if (ops.grayscale) args.push("-colorspace", "Gray");

    // Optimization
    args.push("-quality", quality.toString());
    args.push("-strip"); // Remove EXIF

    // 4. Handle Watermark (Composite)
    // Complex because we need to load the second image into the stack
    let watermarkCmd = "";
    if (ops.watermark) {
        // We handle watermark by creating a composite command part or using a second convert execution?
        // IM v7 allows complex stacks.
        // Format: input -resize ... null: watermark -resize ... -gravity ... -composite output

        let wmPath = ops.watermark.file;
        if (!wmPath.startsWith("http")) {
            wmPath = `storage/tenants/${tenantId}/uploads/${wmPath}`;
        }

        // Add watermark to stack
        args.push(wmPath);

        // Resize watermark (relative scale?)
        if (ops.watermark.scale) {
            args.push("-resize", `${ops.watermark.scale}%`);
        }

        // Opacity (via alpha channel)
        if (ops.watermark.opacity) {
            // "channel a -evaluate multiply 0.5 +channel" logic for opacity is complex in CLI
            // Easier: "-dissolve" if using "composite" command, but we are using "magick".
            // IM v7: -alpha set -channel A -evaluate multiply 0.3
            const opac = ops.watermark.opacity / 100.0;
            args.push("-alpha", "set", "-channel", "A", "-evaluate", "multiply", opac.toString(), "+channel");
        }

        const gravity = ops.watermark.gravity || "southeast";
        const padding = ops.watermark.padding || "+10+10";
        args.push("-gravity", gravity, "-geometry", padding, "-composite");
    }

    // 5. Output
    const outputFilename = `${output_name}.${format}`;
    const sysOutputPath = `${sysWorkDir}/${outputFilename}`;
    args.push(sysOutputPath);

    // 6. Execution Wrapper
    let sysDestDir = `storage/tenants/${tenantId}/tmp`;
    if (tenantId === "root_test") sysDestDir = `storage/tmp/root_test`;

    await $fs.mkdir(fsWorkDir);

    // Shell Escape Helper
    const shellEscape = (arg) => "'" + arg.replace(/'/g, "'\\''") + "'";
    const escapedArgs = args.map(shellEscape);

    // Destination Logic (Local or Rclone)
    let postProcess = `
        mkdir -p ${sysDestDir}
        mv ${sysWorkDir}/${outputFilename} ${sysDestDir}/
    `;

    if (rclone) {
        // ... (Reuse Rclone logic from media processor) ...
        // Simplified for brevity:
        const rcloneConfig = `[target]\ntype=s3\n...`; // Fill from rclone obj
        await $fs.write(`${fsWorkDir}/rclone.conf`, rcloneConfig);
        const dest = `${rclone.bucket}/${rclone.path || ''}/${outputFilename}`;
        postProcess = `rclone --config ${sysWorkDir}/rclone.conf copyto ${sysOutputPath} target:${dest}`;
    }

    const wrapperScript = `
        #!/bin/bash
        magick ${escapedArgs.join(" ")} > ${sysWorkDir}/magick.log 2>&1
        if [ $? -eq 0 ]; then
            ${postProcess}
        else
            echo "ImageMagick Failed"
            cat ${sysWorkDir}/magick.log
        fi
        rm -rf ${sysWorkDir}
    `;

    const sysScriptPath = `${sysWorkDir}/proc.sh`;
    await $fs.write(`./img_job_${jobId}/proc.sh`, wrapperScript);
    await $cmd.run("chmod", ["+x", sysScriptPath]);

    const job = await $cmd.spawn("bash", [sysScriptPath], { timeout: 60000 });

    return new Response({
        success: true,
        job_id: job.pid,
        output: outputFilename
    });
}