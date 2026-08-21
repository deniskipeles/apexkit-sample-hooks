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
          added_by: [1]
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

        await $db.records.update(COLLECTION, Number(folder.id), {
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

/**
 * Extracts creator information from expanded profile relation
 */
function getCreatorInfo(record) {
  let profile = record.expand?.added_by;
  if (Array.isArray(profile) && profile.length > 0) {
    profile = profile[0];
  }
  const meta = profile?.data?.metadata || profile?.metadata || {};
  return {
    name: meta.display_name || meta.name || meta.email || 'User',
    email: meta.email || '',
    role: meta.role || 'Member',
    avatar: meta.avatar || null,
    department: meta.department || ''
  };
}

// --- REFERENCE COUNTED SAFE PHYSICAL & HLS CLEANUP ---

async function safelyDeletePhysicalFile(physicalFile, excludeIds = []) {
  if (!physicalFile) return;

  try {
    const excludeSet = new Set(excludeIds.map(Number));

    const referencingRecords = await $db.query({
      from: COLLECTION,
      where: {
        $or: [
          { physical_file: physicalFile },
          { "metadata.storage_filename": physicalFile }
        ]
      },
      limit: 50
    });

    const otherRefs = (referencingRecords || []).filter(r => !excludeSet.has(Number(r.id)));

    if (otherRefs.length === 0) {
      if (typeof $files?.delete === 'function') {
        await $files.delete(physicalFile).catch(() => {});
      }

      const hlsDir = `processed_media/${physicalFile}`;
      if (typeof $fs?.exists === 'function' && typeof $fs?.delete === 'function') {
        const hasHls = await $fs.exists(hlsDir).catch(() => false);
        if (hasHls) {
          await $fs.delete(hlsDir).catch((err) => {
            console.warn(`[Delete] Failed to delete HLS directory ${hlsDir}:`, err);
          });
        }
      }

      if (typeof $cache?.delete === 'function') {
        await $cache.delete(`transcode_lock:${physicalFile}`).catch(() => {});
      }
    }
  } catch (err) {
    console.warn(`[Delete] Error checking physical/HLS file refs for ${physicalFile}:`, err);
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

    allRecords.filter(f => !f.data.is_file).forEach(folder => {
      const folderFullPath = normalizeFolderPath(folder.data.path);
      const parentPath = getParentFolderPath(folderFullPath) || '/';
      const creatorInfo = getCreatorInfo(folder);

      nodes[folderFullPath] = {
        id: String(folder.id),
        name: folder.data.file,
        path: folderFullPath,
        is_file: false,
        parent_path: parentPath,
        children_paths: [],
        metadata: folder.data.metadata || { size: 0 },
        configurations: folder.data.configurations || {},
        added_by: creatorInfo.name,
        created: folder.created,
        updated: folder.updated,
      };
    });

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
      const creatorInfo = getCreatorInfo(f);

      return {
        id: String(f.id),
        path: normalizeFolderPath(f.data.path),
        is_file: f.data.is_file,
        file: f.data.file,
        physical_file: f.data.physical_file || null,
        metadata: f.data.metadata || {},
        configurations: f.data.configurations || {},
        added_by: creatorInfo.name,
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
      const creatorInfo = getCreatorInfo(f);

      return {
        id: String(f.id),
        ...f.data,
        path: normalizeFolderPath(f.data.path),
        added_by: creatorInfo.name,
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
    let profileId = null;

    try {
      const profileRes = await $db.records.list("profiles", {
        filter: { user_id: reqAuthId },
        limit: 1
      });
      if (profileRes.items && profileRes.items.length > 0) {
        profileId = Number(profileRes.items[0].id);
      } else {
        const newProf = await $db.records.create("profiles", {
          user_id: reqAuthId,
          metadata: {
            display_name: c.req.raw?.auth?.email?.split('@')[0] || "User",
            email: c.req.raw?.auth?.email || "user@example.com",
            role: c.req.raw?.auth?.role || "user",
            created_at: new Date().toISOString()
          }
        });
        profileId = Number(newProf.id);
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
      added_by: profileId ? [profileId] : []
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
  if (isNaN(id)) {
    return c.json({ success: false, message: "Invalid ID" }, 400);
  }

  try {
    const target = await $db.records.get(COLLECTION, id);
    if (!target) return c.json({ success: false, message: "Not found" }, 404);

    const isFile = target.data.is_file;
    const itemPath = normalizeFolderPath(target.data.path);

    if (isFile) {
      const fileSize = Number(target.data.metadata?.size) || 0;
      const physicalFile = target.data.physical_file || target.data.metadata?.storage_filename;

      if (physicalFile) {
        await safelyDeletePhysicalFile(physicalFile, [id]);
      }

      await $db.records.delete(COLLECTION, id);

      if (fileSize > 0) {
        await adjustAncestorFolderSizes(itemPath, -fileSize);
      }
    } else {
      const folderPath = itemPath;

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

      const allDeletingIds = [id, ...(children || []).map(child => Number(child.id))];
      let totalDeletedSize = 0;
      const physicalFilesToCheck = new Set();

      for (const child of (children || [])) {
        if (Number(child.id) === id) continue;

        if (child.is_file) {
          totalDeletedSize += (Number(child.metadata?.size) || 0);
          const pFile = child.physical_file || child.metadata?.storage_filename;
          if (pFile) {
            physicalFilesToCheck.add(pFile);
          }
        }

        await $db.records.delete(COLLECTION, Number(child.id)).catch(() => {});
      }

      await $db.records.delete(COLLECTION, id);

      for (const pFile of physicalFilesToCheck) {
        await safelyDeletePhysicalFile(pFile, allDeletingIds);
      }

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
// 6. Rename/Move (PATCH /files/:id) - Hardened & Poison-Proof
// ---------------------------------------------------------
app.patch("/files/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) {
    return c.json({ success: false, message: "Invalid ID parameter" }, 400);
  }

  try {
    const body = await c.req.json();
    const target = await $db.records.get(COLLECTION, id);
    if (!target) return c.json({ success: false, message: "Item not found" }, 404);

    const isFile = target.data.is_file;
    const oldName = target.data.file;
    const oldPath = normalizeFolderPath(target.data.path);
    const newName = body.file ? body.file.trim() : undefined;
    const newPathRaw = body.path;

    if (!isFile && oldPath === '/' && (newName !== undefined || newPathRaw !== undefined)) {
      return c.json({ success: false, message: "Cannot rename or move the root directory" }, 400);
    }

    const updateData = {};
    if (body.configurations !== undefined) updateData.configurations = body.configurations;
    if (body.metadata !== undefined) updateData.metadata = body.metadata;

    if (isFile) {
      const finalFileName = newName || oldName;
      const targetDirectory = newPathRaw !== undefined ? normalizeFolderPath(newPathRaw) : oldPath;

      if (finalFileName !== oldName || targetDirectory !== oldPath) {
        const existingCollision = await $db.query({
          from: COLLECTION,
          where: {
            path: targetDirectory,
            file: finalFileName,
            is_file: true
          },
          limit: 1
        });

        if (existingCollision.length > 0 && Number(existingCollision[0].id) !== id) {
          return c.json({ 
            success: false, 
            message: `A file named '${finalFileName}' already exists in '${targetDirectory}'` 
          }, 409);
        }
      }

      if (newName !== undefined) updateData.file = finalFileName;

      if (targetDirectory !== oldPath) {
        updateData.path = targetDirectory;
        const fileSize = Number(target.data.metadata?.size) || 0;
        if (fileSize > 0) {
          await adjustAncestorFolderSizes(oldPath, -fileSize);
          await adjustAncestorFolderSizes(targetDirectory, fileSize);
        }
      }

      const updated = await $db.records.update(COLLECTION, id, updateData);
      return c.json({ id: String(updated.id), ...updated.data, updated: updated.updated });
    } else {
      const finalFolderName = newName || oldName;
      const currentOldFolderFullPath = oldPath;

      let newFolderFullPath = currentOldFolderFullPath;

      if (newPathRaw !== undefined || newName !== undefined) {
        const parentPath = newPathRaw !== undefined 
          ? normalizeFolderPath(newPathRaw) 
          : (getParentFolderPath(currentOldFolderFullPath) || '/');

        newFolderFullPath = parentPath === '/' 
          ? `/${finalFolderName}/` 
          : `${parentPath}${finalFolderName}/`;
        newFolderFullPath = normalizeFolderPath(newFolderFullPath);
      }

      if (newFolderFullPath !== currentOldFolderFullPath) {
        if (
          newFolderFullPath === currentOldFolderFullPath || 
          newFolderFullPath.startsWith(currentOldFolderFullPath)
        ) {
          return c.json({ 
            success: false, 
            message: `Cannot move folder '${oldName}' into its own subfolder` 
          }, 400);
        }

        const existingFolder = await $db.query({
          from: COLLECTION,
          where: {
            path: newFolderFullPath,
            is_file: false
          },
          limit: 1
        });

        if (existingFolder.length > 0 && Number(existingFolder[0].id) !== id) {
          return c.json({ 
            success: false, 
            message: `A folder with path '${newFolderFullPath}' already exists` 
          }, 409);
        }
      }

      if (newName !== undefined) updateData.file = finalFolderName;

      if (newFolderFullPath !== currentOldFolderFullPath) {
        updateData.path = newFolderFullPath;

        const oldParent = getParentFolderPath(currentOldFolderFullPath);
        const newParent = getParentFolderPath(newFolderFullPath);
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
            path: { $like: `${currentOldFolderFullPath}%` }
          },
          limit: 10000
        });

        for (const child of children) {
          if (Number(child.id) === id) continue;

          const childPath = normalizeFolderPath(child.path);
          if (childPath.startsWith(currentOldFolderFullPath)) {
            const childRelativePath = childPath.substring(currentOldFolderFullPath.length);
            const updatedChildPath = normalizeFolderPath(`${newFolderFullPath}${childRelativePath}`);
            await $db.records.update(COLLECTION, Number(child.id), { path: updatedChildPath });
          }
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
// 7. Bulk Operations (POST /operations/move & /operations/copy)
// ---------------------------------------------------------

app.post("/operations/move", async (c) => {
  try {
    const { itemIds, targetPath } = await c.req.json();
    const normTarget = normalizeFolderPath(targetPath);
    let success = 0;
    let failed = 0;
    let errors = [];

    let sizeDeltas = {}; 

    for (const rawId of (itemIds || [])) {
      const id = Number(rawId);
      if (isNaN(id)) {
        failed++;
        errors.push(`Invalid ID: ${rawId}`);
        continue;
      }

      try {
        const target = await $db.records.get(COLLECTION, id);
        if (!target) { 
          failed++; 
          errors.push(`Item ${id} not found`);
          continue; 
        }

        const isFile = target.data.is_file;
        const oldPath = normalizeFolderPath(target.data.path);
        
        if (oldPath === normTarget) {
           success++;
           continue;
        }

        const itemSize = Number(target.data.metadata?.size) || 0;

        if (isFile) {
          await $db.records.update(COLLECTION, id, { path: normTarget });
        } else {
          const folderName = target.data.file;
          const oldFolderPath = normalizeFolderPath(oldPath === '/' ? `/${folderName}/` : `${oldPath}${folderName}/`);
          const newFolderPath = normalizeFolderPath(normTarget === '/' ? `/${folderName}/` : `${normTarget}${folderName}/`);

          if (normTarget === oldFolderPath || normTarget.startsWith(oldFolderPath)) {
             throw new Error(`Cannot move folder '${folderName}' into itself`);
          }

          await $db.records.update(COLLECTION, id, { path: normTarget });

          const children = await $db.query({
            from: COLLECTION,
            where: { path: { $like: `${oldFolderPath}%` } },
            limit: 10000
          });

          for (const child of children) {
            const childRelativePath = child.path.substring(oldFolderPath.length);
            const childNewPath = normalizeFolderPath(`${newFolderPath}${childRelativePath}`);
            await $db.records.update(COLLECTION, Number(child.id), { path: childNewPath });
          }
        }

        if (itemSize > 0) {
           sizeDeltas[oldPath] = (sizeDeltas[oldPath] || 0) - itemSize;
           sizeDeltas[normTarget] = (sizeDeltas[normTarget] || 0) + itemSize;
        }

        success++;
      } catch (err) {
        failed++;
        errors.push(err.message || String(err));
      }
    }

    for (const [fPath, delta] of Object.entries(sizeDeltas)) {
       if (delta !== 0) {
          await adjustAncestorFolderSizes(fPath, delta);
       }
    }

    return c.json({ success, failed, errors });
  } catch (e) {
    return c.json({ status: "error", message: e.message || String(e) }, 500);
  }
});

app.post("/operations/copy", async (c) => {
  try {
    const { itemIds, targetPath } = await c.req.json();
    const normTarget = normalizeFolderPath(targetPath);
    
    let success = 0;
    let failed = 0;
    let errors = [];
    let totalSizeAddedToTarget = 0;

    for (const rawId of (itemIds || [])) {
      const id = Number(rawId);
      if (isNaN(id)) {
        failed++;
        errors.push(`Invalid ID: ${rawId}`);
        continue;
      }

      try {
        const target = await $db.records.get(COLLECTION, id);
        if (!target) {
           failed++;
           errors.push(`Item ${id} not found`);
           continue;
        }

        const isFile = target.data.is_file;
        const originalName = target.data.file;
        const oldPath = normalizeFolderPath(target.data.path);
        
        let newName = originalName;
        if (oldPath === normTarget) {
          const nameParts = originalName.split('.');
          if (nameParts.length > 1 && isFile) {
            const ext = nameParts.pop();
            newName = `${nameParts.join('.')} - Copy.${ext}`;
          } else {
            newName = `${originalName} - Copy`;
          }
        }

        const newRecord = await $db.records.create(COLLECTION, {
          path: normTarget,
          is_file: isFile,
          file: newName,
          physical_file: target.data.physical_file,
          metadata: target.data.metadata,
          configurations: target.data.configurations,
          added_by: target.data.added_by
        });

        let itemTotalSize = isFile ? (Number(target.data.metadata?.size) || 0) : 0;

        if (!isFile) {
          const oldFolderPath = normalizeFolderPath(oldPath === '/' ? `/${originalName}/` : `${oldPath}${originalName}/`);
          const newFolderPath = normalizeFolderPath(normTarget === '/' ? `/${newName}/` : `${normTarget}${newName}/`);

          const children = await $db.query({
            from: COLLECTION,
            where: { path: { $like: `${oldFolderPath}%` } },
            limit: 10000
          });

          for (const child of children) {
            if (Number(child.id) === id) continue;
            const childRelativePath = child.path.substring(oldFolderPath.length);
            const childNewPath = normalizeFolderPath(`${newFolderPath}${childRelativePath}`);
            
            await $db.records.create(COLLECTION, {
              path: childNewPath,
              is_file: child.is_file,
              file: child.file,
              physical_file: child.physical_file,
              metadata: child.metadata,
              configurations: child.configurations,
              added_by: child.added_by
            });
            
            if (child.is_file) {
              itemTotalSize += (Number(child.metadata?.size) || 0);
            }
          }
          
          const meta = newRecord.data.metadata || {};
          meta.size = itemTotalSize;
          await $db.records.update(COLLECTION, Number(newRecord.id), { metadata: meta });
        }

        totalSizeAddedToTarget += itemTotalSize;
        success++;
      } catch (err) {
        failed++;
        errors.push(err.message || String(err));
      }
    }

    if (totalSizeAddedToTarget > 0) {
      await adjustAncestorFolderSizes(normTarget, totalSizeAddedToTarget);
    }

    return c.json({ success, failed, errors });
  } catch (e) {
    return c.json({ status: "error", message: e.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------
// 8. User Profile Management (GET /profile & PATCH /profile) 
// ---------------------------------------------------------
app.get("/profile", async (c) => {
  try {
    const reqAuthId = c.req.raw?.auth?.id || 1;
    const profileRes = await $db.records.list("profiles", {
      filter: { user_id: reqAuthId },
      limit: 1
    });

    if (profileRes.items && profileRes.items.length > 0) {
      const p = profileRes.items[0];
      return c.json({
        id: String(p.id),
        user_id: p.data.user_id,
        metadata: p.data.metadata || {}
      });
    }

    return c.json({
      id: "default",
      user_id: reqAuthId,
      metadata: {
        display_name: c.req.raw?.auth?.email?.split('@')[0] || "User",
        email: c.req.raw?.auth?.email || "",
        role: c.req.raw?.auth?.role || "user"
      }
    });
  } catch (e) {
    return c.json({ status: "error", message: e.message || String(e) }, 500);
  }
});

app.patch("/profile", async (c) => {
  try {
    const reqAuthId = c.req.raw?.auth?.id || 1;
    const body = await c.req.json();
    const incomingMetadata = body.metadata || {};

    const profileRes = await $db.records.list("profiles", {
      filter: { user_id: reqAuthId },
      limit: 1
    });

    if (profileRes.items && profileRes.items.length > 0) {
      const p = profileRes.items[0];
      const mergedMetadata = {
        ...(p.data.metadata || {}),
        ...incomingMetadata,
        updated_at: new Date().toISOString()
      };

      const updated = await $db.records.update("profiles", Number(p.id), {
        metadata: mergedMetadata
      });

      return c.json({
        id: String(updated.id),
        user_id: updated.data.user_id,
        metadata: updated.data.metadata
      });
    } else {
      const created = await $db.records.create("profiles", {
        user_id: reqAuthId,
        metadata: {
          ...incomingMetadata,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      });

      return c.json({
        id: String(created.id),
        user_id: reqAuthId,
        metadata: incomingMetadata
      }, 201);
    }
  } catch (e) {
    return c.json({ status: "error", message: e.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------
// 9. Preview Endpoint (GET /preview/:id)
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

    const creatorInfo = getCreatorInfo(target);

    return c.json({
      id: String(target.id),
      file: target.data.file,
      path: target.data.path,
      is_file: target.data.is_file,
      metadata: target.data.metadata || {},
      configurations: target.data.configurations || {},
      preview: previewData,
      added_by: creatorInfo.name,
      created: target.created,
      updated: target.updated
    });
  } catch (e) {
    return c.json({ status: "error", message: e.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------
// 10. Raw File Content Endpoint (GET /content/:id)
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
// 11. HLS Chunked Streaming Endpoint (GET /stream/:id/:filename)
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
          "-b:a", "48k",
          "-ar", "22050",
          "-start_number", "0",
          "-hls_time", "10",
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
          "-b:a", "96k",
          "-start_number", "0",
          "-hls_time", "6",
          "-hls_list_size", "0",
          "-hls_segment_filename", `${tmpDir}/segment_%03d.ts`,
          "-f", "hls",
          `${tmpDir}/index.m3u8`
        ];

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

// ---------------------------------------------------------
// 12. Create / Update Share Link (POST /shares)
// ---------------------------------------------------------
app.post("/shares", async (c) => {
  try {
    const body = await c.req.json();
    const item_id = body.item_id;
    const folder_path = body.folder_path;
    const access_level = body.access_level || "anyone_view";
    const expires_at = body.expires_at;
    const password = body.password;
    let token = body.token;
    
    let password_hash = undefined;
    if (password && password.trim().length > 0) {
      password_hash = $util.hash(password.trim(), "sha256");
    }

    // Safely construct search filter
    let searchFilter = {};
    if (item_id !== undefined && item_id !== null) {
      searchFilter = { item_id: Number(item_id) };
    } else if (folder_path !== undefined && folder_path !== null) {
      searchFilter = { folder_path: String(folder_path) };
    } else {
      return c.json({ success: false, message: "Missing item_id or folder_path" }, 400);
    }

    const existing = await $db.query({
      from: "drive_shares",
      where: searchFilter,
      limit: 1
    });

    if (existing && existing.length > 0) {
      const shareRecord = existing[0];
      token = shareRecord.data.token; // Access via .data
      
      const updateData = { access_level };
      if (expires_at !== undefined && expires_at !== null) updateData.expires_at = expires_at;
      if (password_hash !== undefined) updateData.password_hash = password_hash;

      await $db.records.update("drive_shares", Number(shareRecord.id), updateData);
    } else {
      token = token || $util.randomHex(12);
      
      const createData = { token, access_level };
      // Strip out nulls entirely to prevent serialization panics in Rust
      if (item_id !== undefined && item_id !== null) createData.item_id = Number(item_id);
      if (folder_path !== undefined && folder_path !== null) createData.folder_path = String(folder_path);
      if (expires_at !== undefined && expires_at !== null) createData.expires_at = expires_at;
      if (password_hash !== undefined) createData.password_hash = password_hash;

      await $db.records.create("drive_shares", createData);
    }

    return c.json({ success: true, token });
  } catch (e) {
    return c.json({ status: "error", message: e.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------
// 13. Resolve Share Link Publicly (GET /shares/:token)
// ---------------------------------------------------------
app.get("/shares/:token", async (c) => {
  const token = c.req.param("token");
  const providedPassword = c.req.query("pw");

  try {
    const shares = await $db.query({
      from: "drive_shares",
      where: { token },
      limit: 1
    });

    if (!shares || shares.length === 0) {
      return c.json({ error: "Share link not found or deleted." }, 404);
    }
    
    const shareRecord = shares[0];
    const shareData = shareRecord.data; // Access via .data

    if (shareData.expires_at && new Date(shareData.expires_at) < new Date()) {
      return c.json({ error: "This share link has expired." }, 410);
    }

    if (shareData.password_hash) {
      if (!providedPassword) {
        return c.json({ requirePassword: true }, 401);
      }
      const hashedProvided = $util.hash(providedPassword, "sha256");
      if (hashedProvided !== shareData.password_hash) {
        return c.json({ requirePassword: true, error: "Incorrect password." }, 401);
      }
    }

    let itemData = null;
    let isFolder = false;
    const baseUrl = $env.APP_URL || "";

    if (shareData.item_id) {
      const target = await $db.records.get(COLLECTION, Number(shareData.item_id), "added_by");
      if (!target) return c.json({ error: "Original file no longer exists." }, 404);
      
      isFolder = !target.data.is_file;
      const storageFilename = target.data.physical_file || target.data.metadata?.storage_filename;
      let downloadUrl = null;

      if (storageFilename && typeof $files?.getSignedUrl === 'function') {
        downloadUrl = await $files.getSignedUrl(storageFilename, 3600).catch(() => null);
      }

      const previewData = await generateFilePreview({
        id: target.id,
        ...target.data,
        preview: target.data.preview
      }, baseUrl);

      let creatorName = "User";
      if (target.expand?.added_by) {
        const prof = Array.isArray(target.expand.added_by) ? target.expand.added_by[0] : target.expand.added_by;
        creatorName = prof?.data?.metadata?.display_name || "User";
      }

      itemData = {
        id: String(target.id),
        file: target.data.file,
        path: target.data.path,
        is_file: target.data.is_file,
        metadata: target.data.metadata || {},
        preview: previewData,
        downloadUrl,
        added_by: creatorName,
        created: target.created,
        updated: target.updated
      };
    } else if (shareData.folder_path) {
      isFolder = true;
      const children = await $db.query({
        from: COLLECTION,
        where: { path: shareData.folder_path },
        limit: 1000
      });
      
      itemData = {
        file: shareData.folder_path.split('/').filter(Boolean).pop() || "Root Folder",
        path: shareData.folder_path,
        is_file: false,
        children: (children || []).map(c => ({
          id: String(c.id),
          file: c.data.file,        // Access via .data
          is_file: c.data.is_file,  // Access via .data
          metadata: c.data.metadata || {},
          updated: c.updated
        }))
      };
    }

    return c.json({
      success: true,
      access_level: shareData.access_level,
      isFolder,
      item: itemData
    });

  } catch (e) {
    return c.json({ status: "error", message: e.message || String(e) }, 500);
  }
});

export default async function (req) {
  return app.fetch(req);
}