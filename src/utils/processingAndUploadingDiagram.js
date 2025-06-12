const sharp = require("sharp");
const fs = require("fs");
const uploadToImgBB = require("./uploadToimgBB");

/**
 * Crop and upload diagrams for all questions on a page.
 * Mutates the original diagram_info objects by setting diagram_img_url.
 */
const processingAndUploadingDiagram=async({ diagramInfoList, pageImagePath, pageNum })=> {
  for (let i = 0; i < diagramInfoList.length; i++) {
    const diagram = diagramInfoList[i];
    const boxes = diagram.diagram_bounding_boxes;

    if (!boxes || boxes.length === 0) continue;

    // For now, only crop the 1st bounding box (main diagram)
    const box = boxes[0]; // use multiple if needed
    const cropPath = `pages/page-${pageNum}_diagram_${i}.jpg`;

    try {
      await sharp(pageImagePath)
        .extract({
          left: box.x_min,
          top: box.y_min,
          width: box.x_max - box.x_min,
          height: box.y_max - box.y_min
        })
        .toFile(cropPath);

      const url = await uploadToImgBB(cropPath);
      diagram.diagram_img_url = url;
    } catch (err) {
      console.error(`❌ Failed to crop/upload diagram on page ${pageNum}, diagram ${i}:`, err.message);
      diagram.diagram_img_url = null; // fallback
    }
  }
}

module.exports = processingAndUploadingDiagram;
