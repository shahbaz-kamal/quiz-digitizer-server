//importing required constants and modules
const cors = require("cors");
const express = require("express");
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const fsPromises = fs.promises;
const logger = require("./middlewares/logger");
const upload = require("./middlewares/pdfUploadMulter");
const { PDFDocument } = require("pdf-lib");
const Tesseract = require("tesseract.js");
const { GoogleGenAI } = require("@google/genai");
const poppler = require("pdf-poppler");
const helperForSendingImageToGemini = require("./utils/helperForSendingImageToGemini");
const cropWithFallback = require("./utils/cropWithFallbacks");
const { questionCollection } = require("./utils/connectDB");
const cleanUpPreviousData = require("./utils/cleanUpPreviousData");
const app = express();

// middlewares
const corsOptions = {
  origin: ["http://localhost:5173"],
  credentials: true,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(logger);

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

// CRUD
//initiating gemini api
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.post("/digitalize/process-pdf", upload.single("pdf"), async (req, res) => {
  //  1. Clear database
  await questionCollection.deleteMany({});
  console.log("✅ All previous questions deleted from the database");
  cleanUpPreviousData();

  // *✅  step 1: getting pdf file from frontend (performed in pdfUploadMulter.js middlewares)
  if (!req.file) {
    return res.status(400).send("No file uploaded");
  }

  //* ✅ step 2: converting pdf to image using pdf-poppler

  const filePath = req.file.path;
  console.log(filePath);
  // step 2.1: Using pdf-lib to get total pages
  const pdfBytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const totalPages = pdfDoc.getPageCount();

  // Step 2.2: Converting PDF pages to images using pdf-poppler
  const popplerOptions = {
    format: "jpeg",
    out_dir: "./pages",
    out_prefix: "page",
    page: null, // all pages
    dpi: 600,
  };

  await poppler.convert(filePath, popplerOptions);
  const outputFiles = fs.readdirSync("./pages");

  // Renaming non-padded files to zero-padded (e.g., page-1.jpg → page-01.jpg)
  outputFiles.forEach((file) => {
    const match = file.match(/^page-(\d+)\.jpg$/);
    if (match) {
      const pageNumber = Number(match[1]);
      const padded = String(pageNumber).padStart(2, "0");
      const oldPath = path.join("pages", file);
      const newPath = path.join("pages", `page-${padded}.jpg`);

      fs.renameSync(oldPath, newPath);
    }
  });

  //  * step 3 : scanning each pages with tesseract.js
  const finalQuestions = [];
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const pageImagePath = `pages/page-${
      pageNum < 10 ? `0${pageNum}` : pageNum
    }.jpg`;

    let imageBase64 = null;
    //  Step 3.1: OCR with Tesseract
    const {
      data: { text },
    } = await Tesseract.recognize(pageImagePath, "eng");

    try {
      // Reading  image for Gemini Vision
      const imageBuffer = await fsPromises.readFile(pageImagePath);
      imageBase64 = imageBuffer.toString("base64");
    } catch (ocrError) {
      console.error(
        `Error processing page ${pageNum} with Tesseract or reading image:`,
        ocrError
      );
    }

    //*  Step 4: Using Gemini AI to process the text
    const geminiContents = [
      {
        text: `
    You are an educational content extractor. Extract only printed MCQ-type questions (with clearly visible options) from the provided OCR text and image.
    
    🎯 Focus:
    - Skip handwritten content, SAQ, Problem Solving, or Activity-type questions.
    - Only extract MCQs with visible, printed options in the OCR.
    - Ignore MCQs with missing or unclear options.
    
    📦 For diagrams:
    - Only include if one diagram is visually linked to the MCQ.
    - Use a **single bounding box** that captures the **entire diagram** without cropping.
    - Do not return multiple partial boxes or fragmented visuals.
    - If no diagram, leave the array empty.
    
    📄 Metadata (can be null if not found):
    - "institution_name", "exam_name", "subject", "paper", "class_name", "exam_duration", "global_instructions"
    
    📌 JSON Output (must strictly follow this structure):
    \`\`\`json
    {
      "institution_name": "string | null",
      "exam_name": "string | null",
      "subject": "string | null",
      "paper": "string | null",
      "class_name": "string | null",
      "exam_duration": "string | null",
      "global_instructions": "string | null",
      "questions": [
        {
          "id": "string",
          "individual_instructions": "string | null",
          "main_question_text": "string",
          "diagram_info": [
            {
              "diagram_description": "string",
              "diagram_bounding_boxes": [{"x_min": 0, "y_min": 0, "x_max": 0, "y_max": 0}],
              "position": "string | null",
              "is_table": "boolean",
              "page_number": "string",
              "diagram_img_url": "null"
            }
          ],
          "parts": [
            {
              "part_id": "main",
              "type": "MCQ",
              "question_text": "string",
              "options": ["string", "string", "string", "string"],
              "correct_answer": "string"
            }
          ]
        }
      ]
    }
    \`\`\`
    
    🛑 Do not generate options. Only include MCQs where all options are visible in the OCR text.
    
    🖼 Diagrams must be well-bounded. No split/cropped visuals.
    
    📝 OCR Text for page ${pageNum}:
    ${text}
    
    Now return the full valid JSON as described.
        `,
      },
    ];

    if (imageBase64) {
      geminiContents.push(
        helperForSendingImageToGemini(imageBase64, "image/jpeg")
      );
    }

    let response;

    try {
      response = await ai.models.generateContent({
        model: "gemini-2.5-pro-preview-06-05",
        contents: [{ role: "user", parts: geminiContents }],
        generationConfig: {
          responseMimeType: "application/json",
        },
      });
    } catch (error) {
      console.log(error);
    }

    const responseJsonString = response.text.slice(7, -3); // Remove the "```json" and "```" from the start and end
    let cleanedJsonString = responseJsonString
      .replace(/```json\n?|```/g, "")
      .trim();

    // * Step 5: Cropping diagram with sharp ,uploading it to imageBB and getting the link.

    let parsedPageContent = JSON.parse(cleanedJsonString);
    const diagramsOnPage = [];

    parsedPageContent.questions.forEach((q) => {
      if (Array.isArray(q.diagram_info)) {
        q.diagram_info.forEach((diagram, i) => {
          diagramsOnPage.push({ diagram, question: q, index: i });
        });
      }
    });

    const formattedPageNum = pageNum < 10 ? `0${pageNum}` : `${pageNum}`;

    // Crop and upload each diagram
    for (let d = 0; d < diagramsOnPage.length; d++) {
      const { diagram, question, index } = diagramsOnPage[d];
      const imageUrl = await cropWithFallback(
        pageImagePath,
        diagram,
        `${formattedPageNum}_${d}`
      );

      if (imageUrl) {
        question.diagram_info[index].diagram_img_url = imageUrl;
      } else {
        question.diagram_info[index].diagram_img_url = null;
      }
    }

    finalQuestions.push(parsedPageContent);
    await questionCollection.insertOne(parsedPageContent);
  }
  // *✅ Step 6: Saving final JSON

  fs.writeFileSync("output.json", JSON.stringify(finalQuestions, null, 2)); // Saving the final questions to a JSON file (output.json)
  // deletePdfAfterProcessing(); // Deleting the PDF file after processing

  console.log("✅ Sent final response to client");
  res.json({ status: "success" }); // Sending the final questions as a response
  // try {

  // } catch (error) {
  //   console.error(" Error processing PDF:", error.message);
  //   res.status(500).json({ error: "Internal server error" });
  // }
});

// getting all data
app.get("/get-all-data", async (req, res) => {
  try {
    const allData = await questionCollection.find().toArray();
    console.log("✅ Retrieved questions:", allData.length);
    res.send(allData);
  } catch (error) {
    console.error("❌ Error fetching data:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/", (req, res) => {
  res.send("🔥 quiz digitizer server is running");
});

module.exports = app;
