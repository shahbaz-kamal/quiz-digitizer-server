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

    // Custom padding for each side (in pixels)
    const paddingLeft = 0;
    const paddingRight = 0;
    const paddingTop = 15;
    const paddingBottom = 20;

    let cropArea = null;

    if (
      diagram.diagram_bounding_boxes &&
      diagram.diagram_bounding_boxes.length > 0
    ) {
      const box = diagram.diagram_bounding_boxes[0];

      // const left = Math.max(0, box.x_min - paddingLeft);
      // const right = Math.min(metadata.width, box.x_max + paddingRight);

      const left = Math.max(0, 0 + paddingLeft); // default 0 + optional left padding
      const right = Math.min(metadata.width, metadata.width - paddingRight); // full width - optional right padding

      const top = Math.max(0, box.y_min - paddingTop);

      const bottom = Math.min(metadata.height, box.y_max + paddingBottom);

      cropArea = {
        left,
        top,
        width: right - left,
        height: bottom - top,
      };
    } else {
      // Fallback region-based cropping (no bounding box found)
      const posText = diagram.position?.toLowerCase?.() || "center";

      const W = metadata.width;
      const H = metadata.height;

      const regions = {
        "top-left": { left: 0, top: 0, width: W / 2, height: H / 3 },
        "top-right": { left: W / 2, top: 0, width: W / 2, height: H / 3 },
        center: { left: W / 4, top: H / 3, width: W / 2, height: H / 3 },
        "bottom-left": {
          left: 0,
          top: (2 * H) / 3,
          width: W / 2,
          height: H / 3,
        },
        "bottom-right": {
          left: W / 2,
          top: (2 * H) / 3,
          width: W / 2,
          height: H / 3,
        },
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
