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

  //Using pdf-lib to get total pages
  const pdfBytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const totalPages = pdfDoc.getPageCount();

  // ✅ Step 5.2: Convert PDF pages to images using pdf-poppler
  const popplerOptions = {
    format: "jpeg",
    out_dir: "./pages",
    out_prefix: "page",
    page: null, // all pages
  };
 const data= await poppler.convert(filePath, popplerOptions);

  const finalQuestions = [];
  //set up pdf2pic to convert pages to images

  //  Process each page

  res.send({
    fileUpload: "PDF uploaded successfully: " + req.file.originalname,data
  });
});

app.get("/", (req, res) => {
  res.send("🔥 quiz digitizer server is running");
});

module.exports = app;
