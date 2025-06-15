const fs = require("fs");
const path = require("path");

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log("📁 Created missing directory:", dirPath);
  }
}

function deleteFileSafe(filePath) {
  try {
    fs.unlinkSync(filePath);
    console.log("🗑️ Deleted:", filePath);
  } catch (err) {
    if (err.code === "EPERM") {
      console.warn("🚫 File in use, skipping:", filePath);
    } else {
      console.error("❌ Error deleting:", filePath, err.message);
    }
  }
}

function cleanUpPreviousData() {
  // Use path.resolve to point to correct absolute paths
  const baseDir = path.resolve(__dirname, "../../"); // points to quiz-digitizer-server root
  const pagesDir = path.join(baseDir, "pages");
  const uploadsDir = path.join(baseDir, "uploads");
  const outputPath = path.join(baseDir, "output.json");

  // Ensure pages/ and uploads/ folders exist
  ensureDirExists(pagesDir);
  ensureDirExists(uploadsDir);

  // Delete all JPGs in pages/
  fs.readdirSync(pagesDir).forEach((file) => {
    if (file.endsWith(".jpg")) {
      deleteFileSafe(path.join(pagesDir, file));
    }
  });

  // Delete all PDFs in uploads/
  // fs.readdirSync(uploadsDir).forEach((file) => {
  //   if (file.endsWith(".pdf")) {
  //     deleteFileSafe(path.join(uploadsDir, file));
  //   }
  // });

  // Delete output.json if exists
  try {
    fs.unlinkSync(outputPath);
    console.log("🧹 Deleted old output.json");
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("❌ Failed to delete output.json:", err.message);
    }
  }
}

module.exports = cleanUpPreviousData;
