const express = require("express");
const cors = require("cors");
const fs = require("fs");
const logger = require("./middlewares/logger");
const upload = require("./middlewares/pdfUploadMulter");
const { PDFDocument } = require("pdf-lib");
const Tesseract = require("tesseract.js");

const path = require("path");

const poppler = require("pdf-poppler");

const app = express();

// middlewares
const corsOptions = {
  origin: ["http://localhost:5173"],
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(logger);

// playground
app.post("/digitalize/process-pdf", upload.single("pdf"), async (req, res) => {
  // *step 1: getting pdf file from frontend (performed in pdfUploadMulter.js middlewares)
  if (!req.file) {
    return res.status(400).send("No file uploaded");
  }

  //*  step 2: converting pdf to image using pdf-poppler

  const filePath = req.file.path;

  // step 2.1: Using pdf-lib to get total pages
  const pdfBytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const totalPages = pdfDoc.getPageCount();

  // ✅Step 2.2: Converting PDF pages to images using pdf-poppler
  const popplerOptions = {
    format: "jpeg",
    out_dir: "./pages",
    out_prefix: "page",
    page: null, // all pages
  };
  const data = await poppler.convert(filePath, popplerOptions);

  //  * step 3 : scanning each pages with tesseract.js
  const finalQuestions = [];
  let dataTest;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const pageImagePath = `pages/page-${
      pageNum < 10 ? `0${pageNum}` : pageNum
    }.jpg`;

    // 🧠 Step 5.3.1: OCR with Tesseract
    const {
      data: { text },
    } = await Tesseract.recognize(pageImagePath, "eng");
    finalQuestions.push({ page: pageNum, text: text.trim() });
  }

  res.send({
    fileUpload: "PDF uploaded successfully: " + req.file.originalname,
    finalQuestions,
  });
});

app.get("/", (req, res) => {
  res.send("🔥 quiz digitizer server is running");
});

module.exports = app;
