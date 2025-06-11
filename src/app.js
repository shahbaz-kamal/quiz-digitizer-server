const express = require("express");
const cors = require("cors");
const logger = require("./middlewares/logger");
const upload = require("./middlewares/pdfUploadMulter");

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
  if (!req.file) {
    return res.status(400).send("No file uploaded");
  }

  res.send("PDF uploaded successfully: " + req.file.originalname);
});

app.get("/", (req, res) => {
  res.send("🔥 quiz digitizer server is running");
});

module.exports = app;
