const express = require("express");
require("dotenv").config();
const cors = require("cors");
const fs = require("fs");
const fsPromises = fs.promises;
const logger = require("./middlewares/logger");
const upload = require("./middlewares/pdfUploadMulter");
const { PDFDocument } = require("pdf-lib");
const Tesseract = require("tesseract.js");
const { GoogleGenAI } = require("@google/genai");
// const { GoogleGenerativeAI } = require("@google/generative-ai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const path = require("path");

const poppler = require("pdf-poppler");
const helperForSendingImageToGemini = require("./utils/helperForSendingImageToGemini");

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
    let ocrText = "";
    let imageBase64 = null;
    // 🧠 Step 3.1: OCR with Tesseract
    const {
      data: { text },
    } = await Tesseract.recognize(pageImagePath, "eng");

    try {
      // Read image for Gemini Vision
      const imageBuffer = await fsPromises.readFile(pageImagePath);
      imageBase64 = imageBuffer.toString("base64");
    } catch (ocrError) {
      console.error(
        `Error processing page ${pageNum} with Tesseract or reading image:`,
        ocrError
      );
    }

    //*  Step 4: Using Gemini AI to process the text
    // finalQuestions.push({ page: pageNum, text: text.trim() });
    const geminiContents = [
      {
        text: `
  You are an expert educational content extractor. Your task is to process the provided text (OCR output) from a worksheet page, identify all distinct questions, classify their type, extract relevant details, and note any associated diagrams.

  For each question, determine its type. The possible types are:
  - "MCQ" (Multiple Choice Question): Has a question, specific options (A, B, C, D, or 1, 2, 3, 4), and a single correct answer.
  - "Short Answer" (SAQ): Requires a brief textual answer.
  - "Activity/Instruction": Describes a task or experiment, often with steps, without a specific answer format, or asks for observation/explanation.
  - "Table/Data Interpretation": Involves extracting data from a table or interpreting data from a graph/chart.
  - "Drawing/Labeling": Asks the user to draw something or label parts of a diagram.
  - "Problem Solving": Typically involves calculations or logical deduction, common in Math papers.

  For "MCQ" type questions, try to identify the correct answer if it's explicitly marked or derivable from an accompanying correction template (if provided in the full document context, though for a single page, you might just extract the question and options). Since you are processing one page at a time, just extract the question and options. If a solution format is provided on the page, try to extract it, but prioritize identifying the question itself and its options.

  For questions associated with a diagram, briefly describe the diagram's content and its approximate location or surrounding text, and indicate its presence. If a diagram is visually prominent on the page, even if not directly linked by question text, note it as an independent visual.

  Return the extracted information as a JSON array of objects. Each object in the array should represent a question or a significant content block.

  **JSON Structure:**
  Each question object should have these properties:
  \`\`\`json
  {
    "id": "unique_id_for_question_e.g._Q1", // A unique identifier for the question (e.g., Q1, Q2, Activity1_Q3)
    "instructions": "string", // Any specific instructions or context for the question, if present. Use "null" if not applicable.
    "type": "string", // One of "MCQ", "Short Answer", "Activity/Instruction", "Table/Data Interpretation", "Drawing/Labeling", "Problem Solving", "Other"
    "question_text": "string", // The full text of the question. Include instructions if it's an activity.
    "options": [ // Array of strings, only for MCQ type
      "string" // e.g., "A) Option text", "1) Option text"
    ],
    "correct_answer": "string", // The correct option ID (e.g., "A", "B", "1") or the expected short answer/solution text. If not found on the page, then you find the correct option.
    "diagram_description": Array of string, // A brief description of any associated diagram so that i can generate it with image model (e.g., "Diagram of human digestive system with parts (parts name should be told) A, B, C, D labeled"). Use "null" if no diagram.if there is two diagram please then first diagram description will be added on index 0 and second will be added on index 1 and this will go on
    "diagram_img_url": Array of strings  // just like the diagram description first will be index 0 and second wi;ll be index 1 Indicate a placeholder like "Image placeholder [Diagram 1]" if a diagram is present but you can't save the image directly.
  }
  \`\`\`

  **Considerations:**
  - Group sub-parts of a question (e.g., 10a, 10b, 10c) under a single main question entry, but provide individual properties for each sub-part if they have distinct questions and answers. *Self-correction: For simplicity in initial extraction, treat 10a, 10b as separate questions with a linked parent ID if they appear distinctly in the OCR output.*
  - Be mindful of tables, graphs, and images. Describe them if they are part of a question.
  - Ignore page numbers, headers, footers, and "Do not write in this space" type annotations.
  - If a question has multiple blanks to fill (like in Activity 2, Q3d), represent the blanks in the 'question_text' and try to extract the expected answers for them in 'correct_answer'.

  **Provided Text (OCR Output) for page ${pageNum}:**
  ${text}

  **Image Context (for visual information that Tesseract might miss):**
  [This part will be implicitly handled by Gemini's multimodal capability when you pass the image alongside the prompt. You don't need to put a placeholder here, as the image 'Part' handles it.]

  Now, based on the above instructions and the text, please provide the JSON output. Ensure the output is a valid JSON array.
  `,
      },
    ];

    if (imageBase64) {
      geminiContents.push(
        helperForSendingImageToGemini(imageBase64, "image/jpeg")
      ); // Assuming JPEG format from poppler
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: geminiContents }],
      generationConfig: {
        responseMimeType: "application/json", // Crucial for getting JSON directly
      },
    });
    console.log(response.text);
    const finalResponse = response.text;
    finalQuestions.push({ page: pageNum, finalResponse });
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
