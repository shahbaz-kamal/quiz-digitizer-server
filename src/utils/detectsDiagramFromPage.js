const sharp = require("sharp");
const fs = require("fs");

const detectDiagramsFromPage = async (pageImagePath, pageNum) => {
  const tempImage = sharp(pageImagePath); // just for metadata
  const metadata = await tempImage.metadata();
  const blockHeight = Math.floor(metadata.height / 5);
  const width = metadata.width;
  const diagramPaths = [];

  for (let i = 0; i < 5; i++) {
    const top = i * blockHeight;
    const cropPath = `pages/diagram_${pageNum}_${i}.jpg`;

    // Create a new sharp instance for each extract
    await sharp(pageImagePath)
      .extract({ left: 0, top, width, height: blockHeight })
      .toFile(cropPath);

    const stats = fs.statSync(cropPath);
    if (stats.size > 10000) {
      diagramPaths.push(cropPath);
    } else {
      fs.unlinkSync(cropPath);
    }
  }

  return diagramPaths;
};

module.exports = detectDiagramsFromPage;
