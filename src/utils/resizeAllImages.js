const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const resizeAllImages = async () => {
  const files = fs.readdirSync("./pages");

  for (const file of files) {
    const filePath = path.join("pages", file);

    if (file.endsWith(".jpg") || file.endsWith(".jpeg")) {
      const image = sharp(filePath);
      const metadata = await image.metadata();

      const targetWidth = 720;
      const targetHeight = Math.round(
        (metadata.height * targetWidth) / metadata.width
      );

      const tempPath = path.join("pages", `temp-${file}`);

      // 1. Resize to temp file
      await image
        .resize({ width: targetWidth, height: targetHeight })
        .jpeg({ quality:85 })
        .toFile(tempPath);

      // 2. Replace original with temp
      fs.renameSync(tempPath, filePath);
    }
  }
};

module.exports = { resizeAllImages };
