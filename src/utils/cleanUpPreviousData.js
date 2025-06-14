const fs = require("fs");
const path = require("path");
const { questionCollection } = require("./connectDB");

const cleanUpPreviousData = async () => {
    //  1. Clear database
    await questionCollection.deleteMany({});
    console.log("✅ All previous questions deleted from the database");
  
    //  2. Delete output.json if exists
    const outputPath = "output.json";
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
      console.log("🧹 Deleted old output.json");
    }
  
    //  3. Clean up all .jpg files from /pages
    const pagesDir = "pages";
    fs.readdirSync(pagesDir).forEach((file) => {
      if (file.endsWith(".jpg")) {
        fs.unlinkSync(path.join(pagesDir, file));
      }
    });
    console.log("🖼️ Deleted all images from /pages");
  
    // 🧹 4. Clean up all .pdf files from /uploads
  
  };

  const deletePdfAfterProcessing=()=>{
    const uploadsDir = "uploads";
    fs.readdirSync(uploadsDir).forEach((file) => {
      if (file.endsWith(".pdf")) {
        fs.unlinkSync(path.join(uploadsDir, file));
      }
    });
    console.log("📄 Deleted all PDFs from /uploads");
  }
  
  module.exports = {cleanUpPreviousData, deletePdfAfterProcessing};