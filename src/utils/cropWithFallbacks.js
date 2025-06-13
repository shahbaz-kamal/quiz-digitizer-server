const sharp = require("sharp");
const fs = require("fs");
const uploadToImgBB = require("./uploadToimgBB");

/**
 * Crop a diagram from a page image, using either bounding box or position description.
 * @param {string} imagePath - path to the full page image (jpg)
 * @param {object} diagram - single diagram_info object
 * @param {string} cropId - unique ID for output file
 */
async function cropWithFallback(imagePath, diagram, cropId) {
  try {
    const image = sharp(imagePath);
    const metadata = await image.metadata();

    const padding = 40; // pixels to add around box (adjust as needed)

    let cropArea = null;

    if (
      diagram.diagram_bounding_boxes &&
      diagram.diagram_bounding_boxes.length > 0
    ) {
      const box = diagram.diagram_bounding_boxes[0];
      cropArea = {
        left: Math.max(0, box.x_min - padding),
        top: Math.max(0, box.y_min - padding),
        width: Math.min(metadata.width, box.x_max + padding) - box.x_min + padding,
        height: Math.min(metadata.height, box.y_max + padding) - box.y_min + padding,
      };
    } else {
      // Use position fallback based on human-readable position estimate
      const posText = diagram.position?.toLowerCase?.() || "center";

      const W = metadata.width;
      const H = metadata.height;

      const regions = {
        "top-left": { left: 0, top: 0, width: W / 2, height: H / 3 },
        "top-right": { left: W / 2, top: 0, width: W / 2, height: H / 3 },
        "center": { left: W / 4, top: H / 3, width: W / 2, height: H / 3 },
        "bottom-left": { left: 0, top: (2 * H) / 3, width: W / 2, height: H / 3 },
        "bottom-right": { left: W / 2, top: (2 * H) / 3, width: W / 2, height: H / 3 },
      };

      cropArea = regions[posText] || regions["center"];
    }

    const outputPath = `pages/cropped_${cropId}.jpg`;

    await image.extract(cropArea).toFile(outputPath);
    const url = await uploadToImgBB(outputPath);

    return url;
  } catch (err) {
    console.error("❌ Error cropping with fallback:", err.message);
    return null;
  }
}

module.exports = cropWithFallback;
