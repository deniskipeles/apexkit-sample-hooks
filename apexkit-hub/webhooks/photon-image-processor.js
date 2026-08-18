export const __fileMetadata__ = {
  "id": 404,
  "name": "photon-image-processor",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

import init, { resize, PhotonImage } from "https://esm.sh/@silvia-odwyer/photon@0.3.3";

export default async function (req) {
    await init("https://esm.sh/@silvia-odwyer/photon@0.3.3/es2022/photon_rs_bg.wasm");

    // 1. Read Base64 image
    const base64Data = await $files.read("a9edec4d-0854-40a7-ac6d-e9459ae04e7a.jpg");
    
    // 2. Decode into Uint8Array
    const arrayBuffer = $util.base64DecodeBuffer(base64Data);
    const inputBytes = new Uint8Array(arrayBuffer);

    // 3. Load into Photon
    const img = PhotonImage.new_from_byteslice(inputBytes);
    
    // 4. Resize (returns the new resized PhotonImage)
    const resizedImg = resize(img, 800, 600, 1); 
    
    // 5. Get JPEG output bytes (quality 85)
    const outputBytes = resizedImg.get_bytes_jpeg(85);
    
    // 6. Encode Uint8Array to Base64 using $util.base64Encode
    const outBase64 = $util.base64Encode(outputBytes);
    
    // 7. Save file
    const newFile = await $files.save("resized_output.jpg", outBase64, "image/jpeg");
    
    return new Response({
        success: true,
        message: "Image resized successfully!",
        file: newFile
    });
}
// import init, { resize, PhotonImage } from "https://esm.sh/@silvia-odwyer/photon@0.3.3";

// export default async function (req) {
//     // Pass the explicit WASM URL so it doesn't construct a relative path
//     await init("https://esm.sh/@silvia-odwyer/photon@0.3.3/es2022/photon_rs_bg.wasm");

//     // Read Base64 string from ApexKit File Storage
//     const base64Data = await $files.read("a9edec4d-0854-40a7-ac6d-e9459ae04e7a.jpg");
    
//     // Decode Base64 string into a Uint8Array expected by Photon
//     const binaryString = $util.base64Decode(base64Data);
//     const inputBytes = new Uint8Array(binaryString.length);
//     for (let i = 0; i < binaryString.length; i++) {
//         inputBytes[i] = binaryString.charCodeAt(i);
//     }

//     // Load image into Photon WASM memory space
//     let img = PhotonImage.new_from_byteslice(inputBytes);
    
//     // Perform Rust-speed image manipulation
//     resize(img, 800, 600, 1); 
    
//     // Get output bytes
//     const outputBytes = img.get_bytes();
    
//     return new Response(outputBytes, {
//         headers: { "Content-Type": "image/jpeg" }
//     });
// }