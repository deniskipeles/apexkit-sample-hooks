export const __fileMetadata__ = {
  "id": 35,
  "name": "media-preview",
  "extension": "js",
  "target_collection": null,
  "type": "custom:module",
  "path": "./modules/custom/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

/** @type {import("../../apexkit").FileMetadata} */


// Edge-native AST highlighter executing in QuickJS (Zero client dependencies)
import { highlight } from "https://esm.sh/sugar-high@0.7.0";

export function getPreviewCategory(filename, mimeType = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const mime = (mimeType || '').toLowerCase();

  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico'].includes(ext) || mime.startsWith('image/')) return 'image';
  if (['mp4', 'webm', 'ogg', 'mov', 'mkv', 'm4v', 'avi'].includes(ext) || mime.startsWith('video/')) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext) || mime.startsWith('audio/')) return 'audio';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext) || mime.includes('zip') || mime.includes('archive')) return 'archive';
  return 'text';
}

/**
 * Transforms code into an Atom-One-Dark styled table using the AST highlighter
 */
function renderAstHighlightedHtml(rawText, ext) {
  // 1. Run server-side AST tokenization
  const highlightedCode = highlight(rawText);

  // 2. Wrap into formatted line-number table with dark theme CSS tokens
  const lines = highlightedCode.split('\n');
  const formattedRows = lines.map((lineHtml, idx) => `
    <tr>
      <td style="user-select:none;color:#4b5263;text-align:right;padding-right:16px;width:1%;font-size:11px;font-family:monospace;border-right:1px solid #3e4451;">${idx + 1}</td>
      <td style="padding-left:16px;white-space:pre;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;color:#abb2bf;">${lineHtml}</td>
    </tr>
  `).join('');

  return `
    <style>
      .sh__token--keyword { color: #c678dd; font-weight: 600; }
      .sh__token--string { color: #98c379; }
      .sh__token--comment { color: #5c6370; font-style: italic; }
      .sh__token--entity { color: #61afef; }
      .sh__token--class { color: #e5c07b; }
      .sh__token--ident { color: #e06c75; }
      .sh__token--sign { color: #56b6c2; }
    </style>
    <div style="background:#282c34;border-radius:12px;overflow:hidden;border:1px solid #181a1f;box-shadow:inset 0 1px 3px rgba(0,0,0,0.5);">
      <div style="background:#21252b;padding:8px 16px;border-bottom:1px solid #181a1f;display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;gap:6px;">
          <span style="width:10px;height:10px;border-radius:50%;background:#e06c75;display:inline-block;"></span>
          <span style="width:10px;height:10px;border-radius:50%;background:#e5c07b;display:inline-block;"></span>
          <span style="width:10px;height:10px;border-radius:50%;background:#98c379;display:inline-block;"></span>
        </div>
        <span style="font-family:monospace;font-size:10px;color:#5c6370;text-transform:uppercase;">${ext} • ${lines.length} lines</span>
      </div>
      <div style="padding:16px;overflow-x:auto;max-height:55vh;">
        <table style="border-collapse:collapse;width:100%;line-height:1.6;">
          <tbody>${formattedRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Main Media Processor
 */
export async function generateFilePreview(fileRecord, baseUrl = '') {
  // Return cached preview if present
  // if (fileRecord.preview && Object.keys(fileRecord.preview).length > 0) {
  //   return fileRecord.preview;
  // }

  const filename = fileRecord.file;
  const storageFilename = fileRecord.physical_file || fileRecord.metadata?.storage_filename;
  const mimeType = fileRecord.metadata?.type || fileRecord.metadata?.mimetype || 'application/octet-stream';
  const category = getPreviewCategory(filename, mimeType);

  const result = {
    category,
    filename,
    storageFilename,
    url: storageFilename ? `${baseUrl}/api/v1/storage/file/${storageFilename}` : '',
    htmlContent: null,
    thumbnail: null,
    archiveInfo: null,
    lineCount: 0,
    generatedAt: new Date().toISOString()
  };

  if (!storageFilename) return result;

  try {
    const base64Data = await $files.read(storageFilename);

    // --- 1. CODE / TEXT: Server-side AST Highlighting ---
    if (category === 'text') {
      const rawText = $util.base64Decode(base64Data);
      const ext = (filename.split('.').pop() || 'txt').toLowerCase();
      
      result.lineCount = (rawText.match(/\n/g) || []).length + 1;
      result.htmlContent = renderAstHighlightedHtml(rawText, ext);
    }

    // --- 2. VIDEO / IMAGES: Streamed binary URL (No bulky Base64 in JSON payload) ---
    else if (category === 'image') {
      result.thumbnail = `${baseUrl}/api/v1/webhook/normalised-tree-edge/preview/${fileRecord.id}/${encodeURIComponent(filename)}`;
    }

    // --- 3. ARCHIVES: Fast In-Memory WASM ZIP Inspection ---
    else if (category === 'archive' && filename.toLowerCase().endsWith('.zip')) {
      result.archiveInfo = $zip.inspect(base64Data);
    }

  } catch (e) {
    console.warn(`[PreviewEngine] Failed for ${filename}:`, e);
  }

  return result;
}