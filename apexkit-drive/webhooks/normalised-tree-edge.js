/** @type {import("../apexkit").FileMetadata} */
export const __fileMetadata__ = {
  "name": "normalised-tree-edge",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

import { Hono } from "https://esm.sh/hono";
import { generateFilePreview } from "@/custom/media-preview";

const app = new Hono();
const COLLECTION = 'drive_items';

// --- DEFAULT SYSTEM FOLDERS ---
const DEFAULT_ROOT_FOLDERS = [
  { name: "Documents", path: "/Documents/", icon: "folder-documents" },
  { name: "Downloads", path: "/Downloads/", icon: "folder-downloads" },
  { name: "Pictures", path: "/Pictures/", icon: "folder-pictures" },
  { name: "Projects", path: "/Projects/", icon: "folder-code" }
];

let isSeeded = false;

/**
 * Ensures standard root folders exist in drive_items database table
 */
async function ensureDefaultRootFolders() {
  if (isSeeded) return;
  try {
    const rootFoldersRes = await $db.records.list(COLLECTION, {
      filter: { is_file: false },
      per_page: 100
    });
    const existingPaths = (rootFoldersRes.items || []).map(f => normalizeFolderPath(f.data.path));

    for (const df of DEFAULT_ROOT_FOLDERS) {
      const normPath = normalizeFolderPath(df.path);
      if (!existingPaths.includes(normPath)) {
        await $db.records.create(COLLECTION, {
          path: normPath,
          is_file: false,
          file: df.name,
          physical_file: null,
          metadata: { color: "emerald", icon: df.icon, size: 0 },
          configurations: { defaultFolder: true },
          added_by: 1
        });
      }
    }
    isSeeded = true;
  } catch (err) {
    console.warn("[Seed] Default root folders check:", err);
  }
}

// --- PATH & SIZE RECURSION UTILITIES ---

function normalizeFolderPath(p) {
  if (!p || p === '/') return '/';
  return ('/' + p + '/').replace(/\/+/g, '/');
}

function getParentFolderPath(folderPath) {
  const norm = normalizeFolderPath(folderPath);
  if (norm === '/') return null;
  const segments = norm.split('/').filter(Boolean);
  segments.pop();
  if (segments.length === 0) return '/';
  return '/' + segments.join('/') + '/';
}

function getAncestorPaths(filePath) {
  const norm = normalizeFolderPath(filePath);
  if (norm === '/') return [];
  const segments = norm.split('/').filter(Boolean);
  const ancestors = [];
  let acc = '';
  for (const seg of segments) {
    acc += '/' + seg;
    ancestors.push(acc + '/');
  }
  return ancestors;
}

async function adjustAncestorFolderSizes(filePath, deltaSize) {
  if (!deltaSize || deltaSize === 0) return;
  const ancestors = getAncestorPaths(filePath);

  for (const fPath of ancestors) {
    try {
      const res = await $db.records.list(COLLECTION, {
        filter: { path: fPath, is_file: false },
        limit: 1
      });

      if (res.items && res.items.length > 0) {
        const folder = res.items[0];
        const meta = folder.data.metadata || {};
        const currentSize = Number(meta.size) || 0;
        const newSize = Math.max(0, currentSize + deltaSize);

        await $db.records.update(COLLECTION, folder.id, {
          metadata: {
            ...meta,
            size: newSize
          }
        });
      }
    } catch (err) {
      console.error(`[SizeUpdate] Error adjusting size for folder ${fPath}:`, err);
    }
  }
}

// ---------------------------------------------------------
// 1. Generate Normalised Folder Tree (POST /)
// ---------------------------------------------------------
app.post("/", async (c) => {
  try {
    await ensureDefaultRootFolders();

    const allFilesRes = await $db.records.list(COLLECTION, {
      per_page: 10000,
      expand: "added_by"
    });
    const allRecords = allFilesRes.items || [];

    const nodes = {};

    const totalSizeBytes = allRecords
      .filter(r => r.data.is_file)
      .reduce((acc, curr) => acc + (Number(curr.data.metadata?.size) || 0), 0);

    // 1. Root Node (This PC)
    nodes['/'] = {
      id: 'node-root',
      name: 'This PC',
      path: '/',
      is_file: false,
      parent_path: null,
      children_paths: [],
      metadata: { size: totalSizeBytes },
      configurations: {},
      added_by: 'System',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    // 2. Folder Nodes
    allRecords.filter(f => !f.data.is_file).forEach(folder => {
      const folderFullPath = normalizeFolderPath(folder.data.path);
      const parentPath = getParentFolderPath(folderFullPath) || '/';
      const profile = folder.expand?.added_by;
      const creatorName = profile?.data?.metadata?.display_name || profile?.data?.metadata?.email || 'System';

      nodes[folderFullPath] = {
        id: String(folder.id),
        name: folder.data.file,
        path: folderFullPath,
        is_file: false,
        parent_path: parentPath,
        children_paths: [],
        metadata: folder.data.metadata || { size: 0 },
        configurations: folder.data.configurations || {},
        added_by: creatorName,
        created: folder.created,
        updated: folder.updated,
      };
    });

    // 3. Link parent-child references
    Object.values(nodes).forEach(node => {
      if (node.parent_path && nodes[node.parent_path]) {
        if (!nodes[node.parent_path].children_paths) {
          nodes[node.parent_path].children_paths = [];
        }
        if (!nodes[node.parent_path].children_paths.includes(node.path)) {
          nodes[node.parent_path].children_paths.push(node.path);
        }
      }
    });

    const totalFiles = allRecords.filter(f => f.data.is_file).length;
    const totalFolders = allRecords.filter(f => !f.data.is_file).length;

    const mappedFiles = allRecords.map(f => {
      const profile = f.expand?.added_by;
      const creatorName = profile?.data?.metadata?.display_name || profile?.data?.metadata?.email || 'User';

      return {
        id: String(f.id),
        path: normalizeFolderPath(f.data.path),
        is_file: f.data.is_file,
        file: f.data.file,
        physical_file: f.data.physical_file || null,
        metadata: f.data.metadata || {},
        configurations: f.data.configurations || {},
        added_by: creatorName,
        created: f.created,
        updated: f.updated
      };
    });

    return c.json({
      status: 'success',
      endpoint: '/webhook/normalised-tree-edge',
      timestamp: new Date().toISOString(),
      root_path: '/',
      nodes,
      files: mappedFiles,
      total_files: totalFiles,
      total_folders: totalFolders,
      total_size_bytes: totalSizeBytes
    });
  } catch (e) {
    return c.json({ status: "error", message: e.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------
// 2. List Files & Subfolders in Directory (GET /files)
// ---------------------------------------------------------
app.get("/files", async (c) => {
  try {
    await ensureDefaultRootFolders();
    const targetPath = normalizeFolderPath(c.req.query("path") || "/");

    const allRes = await $db.records.list(COLLECTION, {
      per_page: 10000,
      expand: "added_by"
    });

    const items = (allRes.items || []).filter(item => {
      const itemPath = normalizeFolderPath(item.data.path);
      if (item.data.is_file) {
        return itemPath === targetPath;
      } else {
        const parent = getParentFolderPath(itemPath);
        return parent === targetPath;
      }
    });

    const mapped = items.map(f => {
      const profile = f.expand?.added_by;
      const creatorName = profile?.data?.metadata?.display_name || profile?.data?.metadata?.email || 'User';

      return {
        id: String(f.id),
        ...f.data,
        path: normalizeFolderPath(f.data.path),
        added_by: creatorName,
        created: f.created,
        updated: f.updated
      };
    });

    return c.json(mapped);
  } catch (e) {
    return c.json({ status: "error", message: e.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------
// 3. Search Drive Items (GET /search)
// ---------------------------------------------------------
app.get("/search", async (c) => {
  try {
    const query = c.req.query("q") || "";
    if (!query.trim()) return c.json([]);

    const res = await $db.query({
      from: COLLECTION,
      where: {
        $or: [
          { file: { $contains: query } },
          { path: { $contains: query } }
        ]
      },
      limit: 100
    });

    return c.json(res);
  } catch (e) {
    return c.json({ status: "error", message: e.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------
// 4. Create File or Folder (POST /files)
// ---------------------------------------------------------
app.post("/files", async (c) => {
  try {
    const body = await c.req.json();
    const isFile = body.is_file ?? true;
    const fileName = body.file || (isFile ? 'New File' : 'New Folder');
    let itemPath = body.path || '/';

    if (!isFile) {
      const parentPath = normalizeFolderPath(itemPath);
      itemPath = parentPath === '/' ? `/${fileName}/` : `${parentPath}${fileName}/`;
      itemPath = normalizeFolderPath(itemPath);
    } else {
      itemPath = normalizeFolderPath(itemPath);
    }

    const reqAuthId = c.req.raw?.auth?.id || 1;
    let profileId = reqAuthId;
    try {
      const profileRes = await $db.records.list("profiles", {
        filter: { user_id: reqAuthId },
        limit: 1
      });
      if (profileRes.items && profileRes.items.length > 0) {
        profileId = profileRes.items[0].id;
      }
    } catch (_) { }

    const fileSize = isFile ? (Number(body.metadata?.size) || 0) : 0;
    const metadata = {
      ...(body.metadata || {}),
      size: fileSize
    };

    const data = {
      path: itemPath,
      is_file: isFile,
      file: fileName,
      physical_file: body.physical_file || null,
      metadata: metadata,
      configurations: body.configurations || {},
      added_by: profileId
    };

    const created = await $db.records.create(COLLECTION, data);

    if (isFile && fileSize > 0) {
      await adjustAncestorFolderSizes(itemPath, fileSize);
    }

    return c.json({
      id: String(created.id),
      ...data,
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    }, 201);
  } catch (e) {
    return c.json({ status: "error", message: e.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------
// 5. Delete File or Folder (DELETE /files/:id)
// ---------------------------------------------------------
app.delete("/files/:id", async (c) => {
  const id = Number(c.req.param("id"));

  try {
    const target = await $db.records.get(COLLECTION, id);
    if (!target) return c.json({ success: false, message: "Not found" }, 404);

    const isFile = target.data.is_file;
    const itemPath = normalizeFolderPath(target.data.path);

    if (isFile) {
      const fileSize = Number(target.data.metadata?.size) || 0;

      // [FIXED] Safely invoke file deletion if supported
      if (target.data.physical_file && typeof $files?.delete === 'function') {
        await $files.delete(target.data.physical_file).catch(() => { });
      }

      // Delete record from database collection
      await $db.records.delete(COLLECTION, id);

      // Subtract size from ancestor folders
      if (fileSize > 0) {
        await adjustAncestorFolderSizes(itemPath, -fileSize);
      }
    } else {
      // Deleting a Folder
      const folderPath = itemPath;

      // Find all nested child files and subfolders
      const children = await $db.query({
        from: COLLECTION,
        where: {
          $or: [
            { path: folderPath },
            { path: { $like: `${folderPath}%` } }
          ]
        },
        limit: 10000
      });

      let totalDeletedSize = 0;

      for (const child of children) {
        if (child.id === id) continue;
        if (child.is_file) {
          totalDeletedSize += (Number(child.metadata?.size) || 0);
          if (child.physical_file && typeof $files?.delete === 'function') {
            await $files.delete(child.physical_file).catch(() => { });
          }
        }
        await $db.records.delete(COLLECTION, child.id).catch(() => { });
      }

      // Delete the folder record itself
      await $db.records.delete(COLLECTION, id);

      // Subtract total deleted folder content size from parent ancestors
      const parentPath = getParentFolderPath(folderPath);
      if (parentPath && totalDeletedSize > 0) {
        await adjustAncestorFolderSizes(parentPath, -totalDeletedSize);
      }
    }

    return c.json({ success: true });
  } catch (e) {
    return c.json({ status: "error", message: e.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------
// 6. Rename/Move (PATCH /files/:id)
// ---------------------------------------------------------
app.patch("/files/:id", async (c) => {
  const id = Number(c.req.param("id"));

  try {
    const body = await c.req.json();
    const target = await $db.records.get(COLLECTION, id);
    if (!target) return c.json({ error: "File not found" }, 404);

    const isFile = target.data.is_file;
    const oldName = target.data.file;
    const oldPath = normalizeFolderPath(target.data.path);
    const newName = body.file;
    const newPathRaw = body.path;

    const updateData = {};
    if (newName !== undefined) updateData.file = newName;
    if (body.configurations !== undefined) updateData.configurations = body.configurations;
    if (body.metadata !== undefined) updateData.metadata = body.metadata;

    if (isFile) {
      if (newPathRaw !== undefined) {
        const newPath = normalizeFolderPath(newPathRaw);
        if (newPath !== oldPath) {
          updateData.path = newPath;
          const fileSize = Number(target.data.metadata?.size) || 0;
          if (fileSize > 0) {
            await adjustAncestorFolderSizes(oldPath, -fileSize);
            await adjustAncestorFolderSizes(newPath, fileSize);
          }
        }
      }
      const updated = await $db.records.update(COLLECTION, id, updateData);
      return c.json({ id: String(updated.id), ...updated.data, updated: updated.updated });
    } else {
      let newFolderPath = oldPath;
      if (newPathRaw !== undefined || newName !== undefined) {
        const parentPath = newPathRaw !== undefined ? normalizeFolderPath(newPathRaw) : getParentFolderPath(oldPath) || '/';
        const finalFolderName = newName || oldName;
        newFolderPath = parentPath === '/' ? `/${finalFolderName}/` : `${parentPath}${finalFolderName}/`;
        newFolderPath = normalizeFolderPath(newFolderPath);
      }

      if (newFolderPath !== oldPath) {
        updateData.path = newFolderPath;

        const oldParent = getParentFolderPath(oldPath);
        const newParent = getParentFolderPath(newFolderPath);
        if (oldParent !== newParent) {
          const folderSize = Number(target.data.metadata?.size) || 0;
          if (folderSize > 0) {
            if (oldParent) await adjustAncestorFolderSizes(oldParent, -folderSize);
            if (newParent) await adjustAncestorFolderSizes(newParent, folderSize);
          }
        }

        const children = await $db.query({
          from: COLLECTION,
          where: {
            path: { $like: `${oldPath}%` }
          },
          limit: 10000
        });

        for (const child of children) {
          const updatedChildPath = child.path.replace(oldPath, newFolderPath);
          await $db.records.update(COLLECTION, child.id, { path: updatedChildPath });
        }
      }

      const updated = await $db.records.update(COLLECTION, id, updateData);
      return c.json({ id: String(updated.id), ...updated.data, updated: updated.updated });
    }
  } catch (e) {
    return c.json({ success: false, message: e.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------
// 7. Preview Endpoint (GET /preview/:id)
// ---------------------------------------------------------
app.get("/preview/:id", async (c) => {
  const id = Number(c.req.param("id"));
  try {
    const target = await $db.records.get(COLLECTION, id, "added_by");
    if (!target) return c.json({ error: "File not found" }, 404);

    const baseUrl = $env.APP_URL || "";
    const previewData = await generateFilePreview({
      id: target.id,
      ...target.data,
      preview: target.data.preview
    }, baseUrl);

    if (!target.data.preview || Object.keys(target.data.preview).length === 0) {
      await $db.records.update(COLLECTION, id, { preview: previewData }).catch(() => { });
    }

    const profile = target.expand?.added_by;
    const creatorName = profile?.data?.metadata?.display_name || profile?.data?.metadata?.email || "User";

    return c.json({
      id: String(target.id),
      file: target.data.file,
      path: target.data.path,
      is_file: target.data.is_file,
      metadata: target.data.metadata || {},
      configurations: target.data.configurations || {},
      preview: previewData,
      added_by: creatorName,
      created: target.created,
      updated: target.updated
    });
  } catch (e) {
    return c.json({ status: "error", message: e.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------
// 8. Raw File Content Endpoint (GET /content/:id)
// ---------------------------------------------------------
app.get("/content/:id", async (c) => {
  const id = Number(c.req.param("id"));
  try {
    const target = await $db.records.get(COLLECTION, id);
    if (!target) return c.text("File not found", 404);

    const storageFilename = target.data.physical_file || target.data.metadata?.storage_filename;
    if (!storageFilename) return c.text("No storage file linked", 404);

    const base64Data = await $files.read(storageFilename);
    const rawText = $util.base64Decode(base64Data);

    const mime = target.data.metadata?.type || "text/plain";
    return c.text(rawText, 200, { "Content-Type": `${mime}; charset=utf-8` });
  } catch (e) {
    return c.text(`Error: ${e.message}`, 500);
  }
});

// ---------------------------------------------------------
// 9. HLS Chunked Streaming Endpoint (GET /stream/:id/:filename)
// ---------------------------------------------------------
app.get("/stream/:id/:filename", async (c) => {
  const id = Number(c.req.param("id"));
  const filename = c.req.param("filename");

  try {
    const target = await $db.records.get(COLLECTION, id);
    if (!target) return c.json({ error: "File not found" }, 404);

    const storageFilename = target.data?.physical_file || target.data?.storage_filename;
    if (!storageFilename) return c.text("No storage binary linked", 404);

    const tmpDir = `processed_media/${storageFilename}`;
    const requestedFilePath = `${tmpDir}/${filename}`;

    const readBinary = async (path) => {
      if (typeof $fs.readBytes === 'function') {
        const b64 = await $fs.readBytes(path);
        return $util.base64DecodeBuffer(b64);
      }
      throw new Error("Rust Binary Patch ($fs.readBytes) is required for HLS chunks");
    };

    // 1. Serve cached chunks instantly
    if (await $fs.exists(requestedFilePath)) {
      const buffer = await readBinary(requestedFilePath);
      const mime = filename.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t";
      return new Response(buffer, {
        headers: { 
          "Content-Type": mime, 
          "Cache-Control": filename.endsWith(".m3u8") ? "no-cache" : "public, max-age=31536000",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // 2. Generate playlist & chunks
    if (filename === "index.m3u8") {
      const lockKey = `transcode_lock:${storageFilename}`;
      
      const isAlreadyTranscoding = await $cache.get(lockKey);
      if (isAlreadyTranscoding) {
        console.log(`[HLS] Transcode running for ${storageFilename}, waiting...`);
        for (let i = 0; i < 40; i++) {
          await $util.sleep(1000);
          if (await $fs.exists(requestedFilePath)) {
            const buffer = await readBinary(requestedFilePath);
            return new Response(buffer, {
              headers: { 
                "Content-Type": "application/vnd.apple.mpegurl", 
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*"
              }
            });
          }
        }
        return c.text("Transcoding in progress, please retry in a few seconds.", 503);
      }

      await $cache.set(lockKey, "1", 180);

      try {
        console.log(`\n[HLS] Starting transcoding for: "${storageFilename}"`);
        await $fs.mkdir(tmpDir);

        const ext = storageFilename.split('.').pop() || 'bin';
        const vfsInput = `${tmpDir}/input_media.${ext}`;

        const base64Data = await $files.read(storageFilename);
        await $fs.writeBytes(vfsInput, base64Data);

        const isAudio = /\.(mp3|wav|ogg|m4a|aac|wma|flac)$/i.test(storageFilename);
        console.log(`[HLS] Media category: ${isAudio ? "AUDIO ONLY" : "VIDEO"}`);

        const ffmpegArgs = isAudio ? [
          "-y",
          "-nostdin",
          "-threads", "1",
          "-filter_threads", "1",
          "-loglevel", "info",
          "-stats",
          "-i", vfsInput,
          "-vn",
          "-c:a", "aac",
          "-b:a", "128k",
          "-start_number", "0",
          "-hls_time", "6",
          "-hls_list_size", "0",
          "-hls_segment_filename", `${tmpDir}/segment_%03d.ts`,
          "-f", "hls",
          `${tmpDir}/index.m3u8`
        ] : [
          "-y",
          "-nostdin",
          "-threads", "1",
          "-filter_threads", "1",
          "-loglevel", "info",
          "-stats",
          "-i", vfsInput,
          "-profile:v", "baseline",
          "-level", "3.0",
          "-s", "854x480",
          "-c:a", "aac",
          "-b:a", "128k",
          "-start_number", "0",
          "-hls_time", "6",
          "-hls_list_size", "0",
          "-hls_segment_filename", `${tmpDir}/segment_%03d.ts`,
          "-f", "hls",
          `${tmpDir}/index.m3u8`
        ];

        console.log(`[HLS] Executing FFmpeg WASI...`);
        const t0 = Date.now();

        await $wasm.runWasi("ffmpeg.wasm", ffmpegArgs, { 
          memoryMb: 512, 
          timeoutMs: 180000 
        });

        console.log(`[HLS] Transcode completed in ${((Date.now() - t0) / 1000).toFixed(2)}s`);

        await $fs.delete(vfsInput).catch(() => {});

        if (await $fs.exists(requestedFilePath)) {
          const buffer = await readBinary(requestedFilePath);
          return new Response(buffer, {
            headers: { 
              "Content-Type": "application/vnd.apple.mpegurl", 
              "Cache-Control": "no-cache",
              "Access-Control-Allow-Origin": "*"
            }
          });
        } else {
          return c.text("FFmpeg failed to generate playlist.", 500);
        }
      } finally {
        await $cache.delete(lockKey);
      }
    }

    return c.text("Segment not found", 404);
  } catch (e) {
    console.error(`[HLS Exception]`, e);
    return c.text(`Stream error: ${e.message}`, 500);
  }
}); 

export default async function (req) {
  return app.fetch(req);
}
