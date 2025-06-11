// This code sets up a file upload middleware using multer.
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const uploadPath = path.join(__dirname, "../../src/uploads");
console.log();

if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: "uploads",
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage });

module.exports = upload;