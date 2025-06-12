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
const detectDiagramsFromPage = require("./utils/detectsDiagramFromPage");
const uploadToImgBB = require("./utils/uploadToimgBB");

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
  // *step 0: cleaning up previous uploads and pages
  // fs.readdirSync("pages").forEach((file) => {
  //   if (file.endsWith(".jpg")) fs.unlinkSync(`pages/${file}`);
  // });

  // fs.readdirSync("uploads").forEach((file) => {
  //   if (file.endsWith(".pdf")) fs.unlinkSync(`uploads/${file}`);
  // });

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
  // const digitizedDocumentPages = [];
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
    You are an expert educational content extractor. Your task is to process the provided image (of a worksheet page) and its OCR text. Your goal is to digitize the content into a structured JSON format suitable for building interactive quizzes.
    
    **High-Level Document Metadata Extraction:**
    From the current page, especially if it appears to be a cover page, extract the following overall document details. If not found, return 'null'.
    - "institution_name": string (e.g., "AI TONG SCHOOL", "Anglo-Chinese School")
    - "exam_name": "string" (e.g., "Science Practical Assessment 2024", "2023 P6 PRELIMINARY EXAM", "2024 Term 2 Review")
    - "subject": string (e.g., "Science", "MATHEMATICS")
    - "paper": "string" // (e.g., "Paper 1", "Paper 2", "Paper 3"). Null if not specified.
    - "class_name": string // (e.g., "Primary 4", "P6")
    - "exam_duration": "string" // (e.g., "40 minutes", "1 hour 30 minutes"). Null if not specified.
    - "global_instructions": [Array of  string] // Extract any document-wide instructions (e.g., "INSTRUCTIONS TO CANDIDATES"). Null if not present.
    
    **Question and Content Block Extraction:**
    For each distinct question or logical content block on the page, extract the following details.
    
    **JSON Structure:**
    Return the extracted information as a single JSON object. The 'questions' property will be an array of question objects. Ensure the JSON is valid.
    
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
          "id": "string", // A unique identifier for the question block (e.g., "Q1", "Activity1_Q3", "SectionB_Q10").
          "individual_instructions": "string | null", // Specific instructions for this question block, if it introduces a set of questions (e.g., "Questions 1 to 5 carry 2 marks each."). Null if none.
          "main_question_text": "string | null", // The common text/stem for questions with multiple sub-parts (e.g., "The diagram below shows..."). Null if no sub-parts . it's a single question then that question text will be provided.
          "diagram_info": [ // Array of diagrams/visuals associated with this question block or its main context.
            {
              "diagram_description": "string", // A brief, actionable description of the visual for an image generation model. Include labeled parts where relevant (e.g., "Diagram of human digestive system with parts A, B, C, D labeled").
              "diagram_bounding_boxes": [], // Array of bounding boxes for *each* identified visual element within this diagram_info entry. Each box: { "x_min": number, "y_min": number, "x_max": number, "y_max": number }.
              "is_table": "boolean", // True if the visual is identified as a table that provides data for questions.
              "page_number": "string" // The page number where this specific visual is found (e.g., "01", "02").
            }
          ],
          "parts": [ // Array of question parts. If a single question, it will contain one part with "part_id": "main".
            {
              "part_id": "string", // Identifier for the part (e.g., "a", "b", "c" or "main" for single questions).
              "type": "string", // Shorthanded: "MCQ", "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", "Problem_Solving", "Other".
              "question_text": "string", // The full text of this specific question part. For activities, this is the activity's main instruction/description.
              "options": [], // Array of strings for MCQ options or mathematicla questions that look like short question. Empty array [] if written questions.
              "correct_answer": "string | null" // The correct option text/ID, or expected short answer/solution text. If not explicitly found on the page, return "N/A". DO NOT GUESS for general questions. For Math problems, if an answer is solved/explicitly shown on the page, extract it.
            }
          ]
        }
      ]
    }
    \`\`\`
    
    **Specific Instructions & Considerations:**
    
    1.  **Handwritten Text:** Explicitly ignore any handwritten text, markings, or calculations. Focus solely on printed content.
    2.  **Question Types:**
        * **"MCQ" (Multiple Choice Question):** Has a question, specific options (A, B, C, D, or 1, 2, 3, 4).
        * **"SAQ" (Short Answer Question):** Requires a brief textual answer.
        * **"Activity" (Activity/Instruction):** Describes a task or experiment, often with steps, without a specific answer format, or asks for observation/explanation. Treat "Activity 1", "Activity 2", etc., as primary question blocks. Their introductory text (e.g., "ACTIVITY 1 (8 marks) Materials given: ... Instructions: ...") should be the 'main_question_text' or part of the first 'question_text' in the 'parts' array.
        * **"Table_Interp" (Table/Data Interpretation):** Involves extracting data from a table or interpreting data from a graph/chart.
        * **"Drawing_Labeling" (Drawing/Labeling):** Asks the user to draw something or label parts of a diagram.
        * **"Problem_Solving" (Problem Solving):** Typically involves calculations or logical deduction, common in Math papers.
        * **"Other":** For anything not fitting the above.
    3.  **Options Generation:**
        * If a question is clearly an MCQ and options are provided in the OCR text, extract them into the "options" array.
        * If a question is a mathematical problem or a Short Answer type and *no explicit options are given*, set "options: []". Do NOT generate arbitrary options.
        * If a question is a "Drawing_Labeling" or "Activity" type, set "options: []".
    4.  **Correct Answer Determination:**
        * If a clear correct answer (e.g., circled option, explicit answer in a table, solved working visibly shown on the page for a mathematical problem, or answers from a correction template shown on the same page) is present, extract it into "correct_answer".
        * If the "correct_answer" cannot be confidently extracted from the current page's context, set "correct_answer: "N/A" ". Do not guess.
    5.  **Diagrams and Tables:**
        * For any visual elements (diagrams, graphs, charts, images) that are part of a question's context or a standalone visual on the page, provide a "diagram_description" and an array of "diagram_bounding_boxes".
        * "diagram_bounding_boxes" should contain precise pixel coordinates for *each significant element* within the visual (e.g., for a diagram with labels, provide a box for the overall diagram AND for each label if distinguishable).
        * If a visual is a table that provides data for questions, set "is_table: true".
        * If a table is used *as options* within an MCQ (e.g., a classification question where options are presented in rows/columns), treat these rows/columns as options in the "options" array, and do NOT include them in "diagram_info" (unless the table itself is also a primary diagram for the question, then include it but note it's also acting as options).
    6.  **Sub-Question Grouping:**
        * If a question has a main descriptive text/diagram (e.g., "The diagram below shows...", "The following table shows...") followed by sub-questions (a), (b), (c) that refer to that main text/diagram (e.g., Q8, Q9, Q10 in "P6 done ACS_Primary 2 3.02.04 AM.pdf"), then:
            * Create *one* question object for the main question block.
            * Populate "main_question_text" with the common description.
            * Place each sub-question (a), (b), (c) as separate objects within the "parts" array, each with its "part_id", "type", ""question_text, "options" (if MCQ), and "correct_answer".
            * "diagram_info" should be at the main question object level if it applies to all parts.
        * If questions are distinct and sequentially numbered (e.g., 1, 2, 3...) with no shared stem, create separate question objects for each, and their "parts" array will contain a single entry with '"part_id": "main"'.
    7.  **Individual Instructions:** If a text block provides instructions for a *set* of questions (e.g., "Questions 1 to 5 carry 2 marks each."), capture this text in the "individual_instructions" property of the *first question object* it applies to.
    
    **Provided Text (OCR Output for page ${pageNum}):**
    ${text}
    
    **Image Context:**
    [The image of the page itself will be provided alongside this text via the multimodal API input. Gemini will use its visual understanding in conjunction with the OCR text.]
    
    Now, based on the above comprehensive instructions and the text, please provide the JSON output. Ensure the output is a single, valid JSON object following the specified structure.
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
    // console.log(response.text);
    const responseJsonString = response.text.slice(7, -3); // Remove the "```json" and "```" from the start and end
    let cleanedJsonString = responseJsonString
      .replace(/```json\n?|```/g, "")
      .trim();
    let parsedPageContent = JSON.parse(cleanedJsonString);
    finalQuestions.push(parsedPageContent);
    // let questions = JSON.parse(questionsRaw);

    // finalQuestions.push({ page: pageNum, finalResponse });

    // * Step 5: Detect real diagrams visually

    // const diagramPaths = await detectDiagramsFromPage(pageImagePath, pageNum);
    // const diagramUrls = await Promise.all(diagramPaths.map(uploadToImgBB));

    // 🧩 Step 5.3.4: Attach diagrams to matching questions (1-to-1 order)
    // questions.forEach((q, i) => {
    //   q.diagram = diagramUrls[i] || null;
    // });
  }
  // *✅ Step 6: Saving final JSON
  console.log(finalQuestions);
  fs.writeFileSync("output.json", JSON.stringify(finalQuestions, null, 2));
  res.json(finalQuestions);
  // res.send({
  //   fileUpload: "PDF uploaded successfully: " + req.file.originalname,
  //   finalQuestions,
  // });
});

app.get("/", (req, res) => {
  res.send("🔥 quiz digitizer server is running");
});

module.exports = app;
