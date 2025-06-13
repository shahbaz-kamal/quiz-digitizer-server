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
const processingAndUploadingDiagram = require("./utils/processingAndUploadingDiagram");
const cropWithFallback = require("./utils/cropWithFallbacks");

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
    dpi: 600,
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
      // Reading image image for Gemini Vision
      const imageBuffer = await fsPromises.readFile(pageImagePath);
      imageBase64 = imageBuffer.toString("base64");
    } catch (ocrError) {
      console.error(
        `Error processing page ${pageNum} with Tesseract or reading image:`,
        ocrError
      );
    }

    //*  Step 4: Using Gemini AI to process the text
 
    // const geminiContents = [
    //   {
    //     text: `
    //     You are an expert educational content extractor. Your task is to process the provided image (of a worksheet page) and its OCR text. Your goal is to digitize the content into a structured JSON format suitable for building interactive quizzes.

    //     **High-Level Document Metadata Extraction:**
    //     From the current page, especially if it appears to be a cover page, extract the following overall document details. If not found, return 'null'.
    //     - "institution_name": string (e.g., "AI TONG SCHOOL", "Anglo-Chinese School")
    //     - "exam_name": "string" (e.g., "Science Practical Assessment 2024", "2023 P6 PRELIMINARY EXAM", "2024 Term 2 Review")
    //     - "subject": string (e.g., "Science", "MATHEMATICS")
    //     - "paper": "string" // (e.g., "Paper 1", "Paper 2", "Paper 3"). Null if not specified.
    //     - "class_name": string // (e.g., "Primary 4", "P6")
    //     - "exam_duration": "string" // (e.g., "40 minutes", "1 hour 30 minutes"). Null if not specified.
    //     - "global_instructions": [Array of  string] // Extract any document-wide instructions (e.g., "INSTRUCTIONS TO CANDIDATES"). Null if not present.

    //     **Question and Content Block Extraction:**
    //     For each distinct question or logical content block on the page, extract the following details.

    //     **JSON Structure:**
    //     Return the extracted information as a single JSON object. The 'questions' property will be an array of question objects. Ensure the JSON is valid.

    //     \`\`\`json
    //     {
    //       "institution_name": "string | null",
    //       "exam_name": "string | null",
    //       "subject": "string | null",
    //       "paper": "string | null",
    //       "class_name": "string | null",
    //       "exam_duration": "string | null",
    //       "global_instructions": "string | null",
    //       "questions": [
    //         {
    //           "id": "string", // A unique identifier for the question block (e.g., "Q1", "Activity1_Q3", "SectionB_Q10").
    //           "individual_instructions": "string | null", // Specific instructions for this question block, if it introduces a set of questions (e.g., "Questions 1 to 5 carry 2 marks each."). Null if none.
    //           "main_question_text": "string | null", // The common text/stem for questions with multiple sub-parts (e.g., "The diagram below shows..."). Null if no sub-parts . it's a single question then that question text will be provided.
    //  "diagram_info": [ // Array of diagrams/visuals associated with this question block or its main context. Empty array if no diagrams.
    //   {
    //     "diagram_description": "string", // A brief, actionable description of the visual for an image generation model. Include labeled parts where relevant (e.g., "Diagram of human digestive system with parts A, B, C, D labeled").

    //   "diagram_bounding_boxes": [], // CRITICAL: This array MUST contain **EXACTLY ONE** object representing the **overall bounding box** for the *entire* main diagram or visual. The box should encompass the full diagram and **include a safe amount of whitespace around it**, especially vertically (e.g., extend 20-30 pixels or 5% of its height above and below its detected visual boundary) to ensure no parts are cut off. Horizontally, it can extend to the page edges if needed. For tables, provide the single overall bounding box for the entire table, with similar padding. If there are **multiple distinct main diagrams** on the page, create a separate entry in the "diagram_info" array for *each* of them, and each entry will have its own single, overall bounding box. If no diagram or table is present, return an empty array []. Example: [{"x_min": 100, "y_min": 200, "x_max": 700, "y_max": 800}]

    //   "position": "string | null" // , e.g., "top-left", "center", "bottom-right"
    //     "is_table": "boolean", // True if the visual is identified as a table that provides data for questions.
    //     "page_number": "string", // The page number where this specific visual is found (e.g., "01", "02"). Always provide.
    //     "diagram_img_url": "null" // Placeholder, will be filled by backend after imgbb upload.
    //   }
    // ],
    //    "parts": [ // Array of question parts. If a single question, it will contain one part with "part_id": "main".
    //             {
    //               "part_id": "string", // Identifier for the part (e.g., "a", "b", "c" or "main" for single questions).
    //               "type": "string", // Shorthanded: "MCQ", "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", "Problem_Solving", "Other".
    //               "question_text": "string", // The full text of this specific question part. For activities, this is the activity's main instruction/description.
    //          "options": [], // Array of strings.
    //                                // - If question type is "MCQ" AND options are provided in the OCR text: Extract the string content only (remove numbering/lettering like "1)", "A)").
    //                                // - If question type is "MCQ" AND NO options are provided in the OCR text: Generate 4 plausible options, where one is the correct answer and three are incorrect distractor options. Ensure options are simple strings (no numbering/lettering).
    //                                // - If question type is "Problem_Solving" AND NO options are provided in the OCR text: Calculate the answer, then generate 4 plausible options (1 correct, 3 incorrect distractors) that are related to the question's context. Ensure options are simple strings (no numbering/lettering).
    //                                // - For "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", "Other" types: This array MUST be empty [].
    //                                // The options array MUST NOT be empty unless the question type is , "Activity", "Table_Interp", "Drawing_Labeling", or "Other".
    //                 "correct_answer": "string | null", // The correct option text.
    //                                    // - If question type is "MCQ" or "Problem_Solving" (where options are extracted or generated): This MUST be the exact string of the correct option found within the 'options' array.
    //                                    // - For "SAQ": If an explicit answer is given on the page, extract that text. If not, return "N/A".
    //                                    // - For "Activity", "Table_Interp", "Drawing_Labeling", "Other" types: Return "N/A".

    //             }
    //           ]
    //         }
    //       ]
    //     }
    //     \`\`\`

    //     **Specific Instructions & Considerations:**

    //     1.  **Handwritten Text:** Explicitly ignore any handwritten text, markings, or calculations. Focus solely on printed content.
    //     2.  **Question Types:**
    //         * **"MCQ" (Multiple Choice Question):** Has a question, specific options (A, B, C, D, or 1, 2, 3, 4).
    //         * **"SAQ" (Short Answer Question):** Requires a brief textual answer.
    //         * **"Activity" (Activity/Instruction):** Describes a task or experiment, often with steps, without a specific answer format, or asks for observation/explanation. Treat "Activity 1", "Activity 2", etc., as primary question blocks. Their introductory text (e.g., "ACTIVITY 1 (8 marks) Materials given: ... Instructions: ...") should be the 'main_question_text' or part of the first 'question_text' in the 'parts' array.
    //         * **"Table_Interp" (Table/Data Interpretation):** Involves extracting data from a table or interpreting data from a graph/chart.
    //         * **"Drawing_Labeling" (Drawing/Labeling):** Asks the user to draw something or label parts of a diagram.
    //         * **"Problem_Solving" (Problem Solving):** Typically involves calculations or logical deduction, common in Math papers.
    //         * **"Other":** For anything not fitting the above.
    //       3.  **Options Generation:**
    //           * If question type is "MCQ" AND options are provided in the OCR text: Extract the string content only (remove numbering/lettering like "1)", "A)").
    //           * If question type is "MCQ" AND NO options are provided in the OCR text: Generate 4 plausible options, where one is the correct answer and three are incorrect distractor options. Ensure options are simple strings (no numbering/lettering).
    //           * If question type is "Problem_Solving" AND NO options are provided in the OCR text: Calculate the answer, then generate 4 plausible options (1 correct, 3 incorrect distractors) that are related to the question's context. Ensure options are simple strings (no numbering/lettering).
    //           * For "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", "Other" types: This array MUST be empty [].
    //           * The options array MUST NOT be empty unless the question type is "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", or "Other".
    //       4.  **Correct Answer Determination:**
    //           * If a clear correct answer is explicitly present on the page (e.g., a circled option, an explicit answer in a table, or solved working visibly shown on the page for a mathematical problem), extract that answer.
    //           * For question types "MCQ" or "Problem_Solving" (where options are extracted or generated): This MUST be the exact string of the correct option found within the 'options' array.
    //           * For "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", "Other" types: If an explicit textual solution is provided on the page, extract that text into 'correct_answer'. If no explicit solution is given on the page, set 'correct_answer: "N/A"'. Do not guess for these types.
    //     5.  **Diagrams and Tables:**
    //         * For any visual elements (diagrams, graphs, charts, images) that are part of a question's context or a standalone visual on the page, provide a "diagram_description" and an array of "diagram_bounding_boxes".
    //         * "diagram_bounding_boxes" : This array MUST contain **EXACTLY ONE** object representing the **overall bounding box** for the *entire* main diagram or visual. The box should encompass the full diagram and **include a safe amount of whitespace around it**, especially vertically (e.g., extend 20-30 pixels or 5% of its height above and below its detected visual boundary) to ensure no parts are cut off. Horizontally, it can extend to the page edges if needed. For tables, provide the single overall bounding box for the entire table, with similar padding. If there are **multiple distinct main diagrams** on the page, create a separate entry in the "diagram_info" array for *each* of them, and each entry will have its own single, overall bounding box. If no diagram or table is present, return an empty array []. Example: [{"x_min": 100, "y_min": 200, "x_max": 700, "y_max": 800}]
    //         * If a visual is a table that provides data for questions, set "is_table: true".
    //         * If a table is used *as options* within an MCQ (e.g., a classification question where options are presented in rows/columns), treat these rows/columns as options in the "options" array, and do NOT include them in "diagram_info" (unless the table itself is also a primary diagram for the question, then include it but note it's also acting as options).
    //     6.  **Sub-Question Grouping:**
    //         * If a question has a main descriptive text/diagram (e.g., "The diagram below shows...", "The following table shows...") followed by sub-questions (a), (b), (c) that refer to that main text/diagram (e.g., Q8, Q9, Q10 in "P6 done ACS_Primary 2 3.02.04 AM.pdf"), then:
    //             * Create *one* question object for the main question block.
    //             * Populate "main_question_text" with the common description.
    //             * Place each sub-question (a), (b), (c) as separate objects within the "parts" array, each with its "part_id", "type", ""question_text, "options" (if MCQ), and "correct_answer".
    //             * "diagram_info" should be at the main question object level if it applies to all parts.
    //         * If questions are distinct and sequentially numbered (e.g., 1, 2, 3...) with no shared stem, create separate question objects for each, and their "parts" array will contain a single entry with '"part_id": "main"'.
    //     7.  **Individual Instructions:** If a text block provides instructions for a *set* of questions (e.g., "Questions 1 to 5 carry 2 marks each."), capture this text in the "individual_instructions" property of the *first question object* it applies to.

    //     **Provided Text (OCR Output for page ${pageNum}):**
    //     ${text}

    //     **Image Context:**
    //     [The image of the page itself will be provided alongside this text via the multimodal API input. Gemini will use its visual understanding in conjunction with the OCR text.]

    //     Now, based on the above comprehensive instructions and the text, please provide the JSON output. Ensure the output is a single, valid JSON object following the specified structure.
    //         `,
    //   },
    // ];

    // const geminiContents = [
    //   {
    //     text: `
    //       **CRITICAL INSTRUCTION: Your entire output MUST be a single, perfectly valid JSON object. Ensure ALL property names are enclosed in double-quotes, and strictly adhere to JSON syntax (e.g., no trailing commas, strings must be double-quoted). This is PARAMOUNT for parsing.**

    //       You are an expert educational content extractor. Your task is to process the provided image (of a worksheet page) and its OCR text. Your goal is to digitize the content into a structured JSON format suitable for building interactive quizzes.

    //       **High-Level Document Metadata Extraction:**
    //       From the current page, especially if it appears to be a cover page, extract the following overall document details. If not found, return 'null'.
    //       - "institution_name": "string" (e.g., "AI TONG SCHOOL", "Anglo-Chinese School")
    //       - "exam_name": "string" (e.g., "Science Practical Assessment 2024", "2023 P6 PRELIMINARY EXAM", "2024 Term 2 Review")
    //       - "subject": "string" (e.g., "Science", "MATHEMATICS")
    //       - "paper": "string" // (e.g., "Paper 1", "Paper 2", "Paper 3"). Null if not specified.
    //       - "class_name": "string" // (e.g., "Primary 4", "P6")
    //       - "exam_duration": "string" // (e.g., "40 minutes", "1 hour 30 minutes"). Null if not specified.
    //       - "global_instructions": "string | null" // Extract any document-wide instructions (e.g., "INSTRUCTIONS TO CANDIDATES"). Combine multi-line instructions into a single string. Null if not present.

    //       **Question and Content Block Extraction:**
    //       For each distinct question or logical content block on the page, extract the following details.

    //       **JSON Structure:**
    //       Return the extracted information as a single JSON object. The 'questions' property will be an array of question objects. Ensure the JSON is valid.

    //       \`\`\`json
    //       {
    //         "institution_name": "string | null",
    //         "exam_name": "string | null",
    //         "subject": "string | null",
    //         "paper": "string | null",
    //         "class_name": "string | null",
    //         "exam_duration": "string | null",
    //         "global_instructions": "string | null",
    //         "questions": [
    //           {
    //             "id": "string", // A unique identifier for the question block (e.g., "Q1", "Activity1_Q3", "SectionB_Q10").
    //             "individual_instructions": "string | null", // Specific instructions for this question block, if it introduces a set of questions (e.g., "Questions 1 to 5 carry 2 marks each."). Null if none.
    //             "main_question_text": "string | null", // The common text/stem for questions with multiple sub-parts (e.g., "The diagram below shows..."). Null if no sub-parts . it's a single question then that question text will be provided.
    //             "diagram_info": [ // Array of diagrams/visuals associated with this question block or its main context. Empty array if no diagrams.
    //               {
    //                 "diagram_description": "string", // A brief, actionable description of the visual for an image generation model. Include labeled parts where relevant (e.g., "Diagram of human digestive system with parts A, B, C, D labeled").
    //                 // STAMP: FIX FOR JSON SYNTAX ERROR - Corrected prompt to ensure proper JSON bounding box format
    //                 "diagram_bounding_boxes": [], // CRITICAL: PROVIDE AN ARRAY OF OBJECTS. Each object is a bounding box: { "x_min": number, "y_min": number, "x_max": number, "y_max": number }. Example: [{"x_min": 100, "y_min": 200, "x_max": 300, "y_max": 400}]. I want to capture the whole diagram in one go. If there are more than one diagram then give two arrays containing the information. I want the overall bounding box for the main diagram so that i can crop the diagram by using sharp. If the visual is a table, provide bounding boxes for the overall table so that i can crop the table with sharp . If no bounding boxes are available, return an empty array [].
    //                 "is_table": "boolean", // True if the visual is identified as a table that provides data for questions.
    //                 "page_number": "string", // The page number where this specific visual is found (e.g., "01", "02"). Always provide.
    //                 "diagram_img_url": "null" // Placeholder, will be filled by backend after imgbb upload.
    //               }
    //             ],
    //             "parts": [ // Array of question parts. If a single question, it will contain one part with "part_id": "main".
    //               {
    //                 "part_id": "string", // Identifier for the part (e.g., "a", "b", "c" or "main" for single questions).
    //                 "type": "string", // Shorthanded: "MCQ", "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", "Problem_Solving", "Other".
    //                 // STAMP: FIX FOR JSON SYNTAX ERROR - Removed extra quote from "question_text"
    //                 "question_text": "string", // The full text of this specific question part. For activities, this is the activity's main instruction/description.
    //                 "options": [], // Array of strings.
    //                                // - If question type is "MCQ" AND options are provided in the OCR text: Extract the string content only (remove numbering/lettering like "1)", "A)").
    //                                // - If question type is "MCQ" AND NO options are provided in the OCR text: Generate 4 plausible options, where one is the correct answer and three are incorrect distractor options. Ensure options are simple strings (no numbering/lettering).
    //                                // - If question type is "Problem_Solving" AND NO options are provided in the OCR text: Calculate the answer, then generate 4 plausible options (1 correct, 3 incorrect distractors) that are related to the question's context. Ensure options are simple strings (no numbering/lettering).
    //                                // - For "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", "Other" types: This array MUST be empty [].
    //                                // The options array MUST NOT be empty unless the question type is , "Activity", "Table_Interp", "Drawing_Labeling", or "Other".
    //                 "correct_answer": "string | null", // The correct option text.
    //                                    // - If question type is "MCQ" or "Problem_Solving" (where options are extracted or generated): This MUST be the exact string of the correct option found within the 'options' array.
    //                                    // - For "SAQ": If an explicit answer is given on the page, extract that text. If not, return "N/A".
    //                                    // - For "Activity", "Table_Interp", "Drawing_Labeling", "Other" types: Return "N/A".
    //                 "page_number": "string" // Added page_number to part
    //               }
    //             ]
    //           }
    //         ]
    //       }
    //       \`\`\`

    //       **Specific Instructions & Considerations:**

    //       1.  **Handwritten Text:** Explicitly ignore any handwritten text, markings, or calculations. Focus solely on printed content.
    //       2.  **Question Types:**
    //           * "MCQ" (Multiple Choice Question): Has a question, specific options (A, B, C, D, or 1, 2, 3, 4).
    //           * "SAQ" (Short Answer Question): Requires a brief textual answer.
    //           * "Activity" (Activity/Instruction): Describes a task or experiment, often with steps, without a specific answer format, or asks for observation/explanation. Treat "Activity 1", "Activity 2", etc., as primary question blocks. Their introductory text (e.g., "ACTIVITY 1 (8 marks) Materials given: ... Instructions: ...") should be the 'main_question_text' or part of the first 'question_text' in the 'parts' array.
    //           * "Table_Interp" (Table/Data Interpretation): Involves extracting data from a table or interpreting data from a graph/chart.
    //           * "Drawing_Labeling" (Drawing/Labeling): Asks the user to draw something or label parts of a diagram.
    //           * "Problem_Solving" (Problem Solving): Typically involves calculations or logical deduction, common in Math papers.
    //           * "Other": For anything not fitting the above.
    //       3.  **Options Generation:**
    //           * If question type is "MCQ" AND options are provided in the OCR text: Extract the string content only (remove numbering/lettering like "1)", "A)").
    //           * If question type is "MCQ" AND NO options are provided in the OCR text: Generate 4 plausible options, where one is the correct answer and three are incorrect distractor options. Ensure options are simple strings (no numbering/lettering).
    //           * If question type is "Problem_Solving" AND NO options are provided in the OCR text: Calculate the answer, then generate 4 plausible options (1 correct, 3 incorrect distractors) that are related to the question's context. Ensure options are simple strings (no numbering/lettering).
    //           * For "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", "Other" types: This array MUST be empty [].
    //           * The options array MUST NOT be empty unless the question type is "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", or "Other".
    //       4.  **Correct Answer Determination:**
    //           * If a clear correct answer is explicitly present on the page (e.g., a circled option, an explicit answer in a table, or solved working visibly shown on the page for a mathematical problem), extract that answer.
    //           * For question types "MCQ" or "Problem_Solving" (where options are extracted or generated): This MUST be the exact string of the correct option found within the 'options' array.
    //           * For "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", "Other" types: If an explicit textual solution is provided on the page, extract that text into 'correct_answer'. If no explicit solution is given on the page, set 'correct_answer: "N/A"'. Do not guess for these types.
    //       5.  **Diagrams and Tables:**
    //           * For any visual elements (diagrams, graphs, charts, images) that are part of a question's context or a standalone visual on the page, provide a "diagram_description" and an array of "diagram_bounding_boxes".
    //           * "diagram_bounding_boxes" MUST contain precise pixel coordinates for *each significant visual element* identified as part of a diagram or standalone image. If multiple distinct visual elements are part of one diagram (e.g., an image and its associated text labels that are separated), provide a bounding box for *each* element. The format must be an array of objects: '[{"x_min": number, "y_min": number, "x_max": number, "y_max": number}, {"x_min": ..., "y_min": ..., "x_max": ..., "y_max": ...}]'. If no diagram is present, this array should be empty [].
    //           * If a visual is a table that provides data for questions, it MUST have "is_table: true" and its "diagram_bounding_boxes".
    //           * If a table is used *as options* within an MCQ (e.g., a classification question where options are presented in rows/columns), treat these rows/columns as options in the "options" array, and do NOT include them in "diagram_info" (unless the table itself is also a primary diagram for the question, then include it but note it's also acting as options).
    //       6.  **Sub-Question Grouping:**
    //           * If a question has a main descriptive text/diagram (e.g., "The diagram below shows...", "The following table shows...") followed by sub-questions (a), (b), (c) that refer to that main text/diagram (e.g., Q8, Q9, Q10 in "P6 done ACS_Primary 2 3.02.04 AM.pdf"), then:
    //               * Create *one* question object for the main question block.
    //               * Populate "main_question_text" with the common description.
    //               * Place each sub-question (a), (b), (c) as separate objects within the "parts" array, each with its "part_id", "type", "question_text", "options" (if MCQ), and "correct_answer".
    //               * "diagram_info" should be at the main question object level if it applies to all parts.
    //           * If questions are distinct and sequentially numbered (e.g., 1, 2, 3...) with no shared stem, create separate question objects for each, and their "parts" array will contain a single entry with '"part_id": "main"'.
    //       7.  **Individual Instructions:** If a text block provides instructions for a *set* of questions (e.g., "Questions 1 to 5 carry 2 marks each."), capture this text in the "individual_instructions" property of the *first question object* it applies to.

    //       **Provided Text (OCR Output for page ${pageNum}):**
    //       ${ocrText}

    //       **Image Context:**
    //       [The image of the page itself will be provided alongside this text via the multimodal API input. Gemini will use its visual understanding in conjunction with the OCR text.]

    //       Now, based on the above comprehensive instructions and the text, please provide the JSON output. Ensure the output is a single, valid JSON object following the specified structure.
    //       `,
    //   },
    // ];

    // const geminiContents = [
    //   {
    //     text: `
    //       **CRITICAL INSTRUCTION: Your entire output MUST be a single, perfectly valid JSON object. DO NOT include any comments, explanations, or extraneous text outside or inside the JSON object. All property names and string values MUST be enclosed in double-quotes. Strictly adhere to JSON syntax (e.g., no trailing commas, no single quotes for string values, no undefined/NaN values).**

    //       You are an expert educational content extractor. Your task is to process the provided image (of a worksheet page) and its OCR text. Your goal is to digitize the content into a structured JSON format suitable for building interactive quizzes.

    //       **High-Level Document Metadata Extraction:**
    //       From the current page, especially if it appears to be a cover page or a primary information page, extract the following overall document details. If not found, return 'null'.
    //       - "institution_name": "string" (e.g., 'AI TONG SCHOOL', 'Anglo-Chinese School')
    //       - "exam_name": "string" (e.g., 'Science Practical Assessment 2024', '2023 P6 PRELIMINARY EXAM', '2024 Term 2 Review')
    //       - "subject": "string" (e.g., 'Science', 'MATHEMATICS')
    //       - "paper": "string" // (e.g., 'Paper 1', 'Paper 2', 'Paper 3'). Null if not specified.
    //       - "class_name": "string" // (e.g., 'Primary 4', 'P6')
    //       - "exam_duration": "string" // (e.g., '40 minutes', '1 hour 30 minutes'). Null if not specified.
    //       - "global_instructions": "string | null" // Extract any document-wide instructions (e.g., 'INSTRUCTIONS TO CANDIDATES'). Combine multi-line instructions into a single string. Null if not present.

    //       **Question and Content Block Extraction:**
    //       For each distinct question or logical content block on the page, extract the following details.

    //       **JSON Structure:**
    //       Return the extracted information as a single JSON object. The 'questions' property will be an array of question objects. Ensure the JSON is valid.

    //       \`\`\`json
    //       {
    //         "institution_name": "string | null",
    //         "exam_name": "string | null",
    //         "subject": "string | null",
    //         "paper": "string | null",
    //         "class_name": "string | null",
    //         "exam_duration": "string | null",
    //         "global_instructions": "string | null",
    //         "questions": [
    //           {
    //             "id": "string",
    //             "individual_instructions": "string | null",
    //             "main_question_text": "string | null",
    //             "diagram_info": [
    //               {
    //                 "diagram_description": "string",
    //                 // STAMP: REVISED DIAGRAM BOUNDING BOX INSTRUCTION FOR SINGLE, ENCOMPASSING BOX
    //                 "diagram_bounding_boxes": [], // CRITICAL: This array MUST contain **EXACTLY ONE** object: {"x_min": number, "y_min": number, "x_max": number, "y_max": number}. This single bounding box MUST encompass the **entire main diagram or visual element** on the page. It should include visible labels and ensure a generous whitespace padding (e.g., at least 5% of diagram height/width) around the visual content, especially vertically, to prevent cropping issues. For tables, provide the single overall bounding box for the entire table with similar padding. If there are **multiple distinct main diagrams** on the page, create a separate entry in the "diagram_info" array for *each* of them, and each entry will have its own single, overall bounding box. If no diagram or table is present, return an empty array [].
    //                 "is_table": "boolean",
    //                 "page_number": "string",
    //                 "diagram_img_url": "null"
    //               }
    //             ],
    //             "parts": [
    //               {
    //                 "part_id": "string",
    //                 "type": "string",
    //                 "question_text": "string",
    //                 "options": [],
    //                 "correct_answer": "string | null",
    //                 "page_number": "string"
    //               }
    //             ]
    //           }
    //         ]
    //       }
    //       \`\`\`

    //       **Specific Instructions & Considerations:**

    //       1.  **Handwritten Text:** Explicitly ignore any handwritten text, markings, or calculations. Focus solely on printed content.
    //       2.  **Question Types:**
    //           * "MCQ" (Multiple Choice Question): Has a question, specific options (A, B, C, D, or 1, 2, 3, 4).
    //           * "SAQ" (Short Answer Question): Requires a brief textual answer.
    //           * "Activity" (Activity/Instruction): Describes a task or experiment, often with steps, without a specific answer format, or asks for observation/explanation. Treat "Activity 1", "Activity 2", etc., as primary question blocks. Their introductory text (e.g., 'ACTIVITY 1 (8 marks) Materials given: ... Instructions: ...') should be the 'main_question_text' or part of the first 'question_text' in the 'parts' array.
    //           * "Table_Interp" (Table/Data Interpretation): Involves extracting data from a table or interpreting data from a graph/chart.
    //           * "Drawing_Labeling" (Drawing/Labeling): Asks the user to draw something or label parts of a diagram.
    //           * "Problem_Solving" (Problem Solving): Typically involves calculations or logical deduction, common in Math papers.
    //           * "Other": For anything not fitting the above.
    //       3.  **Options Generation:**
    //           * If a question's 'type' is "MCQ" AND options are provided in the OCR text (e.g., '1) Digestion is complete', 'A. Some option'), **extract only the string content**, removing any leading numbers or letters (e.g., 'Digestion is complete', 'Some option'). Populate these into the 'options' array.
    //           * If a question's 'type' is "MCQ" AND **NO options are provided** in the OCR text for that question: You **MUST generate 4 plausible options**. One option should be the correct answer based on the question text, and the other three should be incorrect but reasonable distractors. Ensure these generated options are clear strings, **without any numbering or lettering**.
    //           * If a question's 'type' is "Problem_Solving" AND **NO options are provided** in the OCR text for that question: You **MUST calculate the correct answer** based on the problem presented. Then, generate 4 plausible options related to the problem (1 correct, 3 incorrect distractors). Ensure these generated options are clear strings, **without any numbering or lettering**.
    //           * For question types "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", or "Other": The 'options' array MUST be empty '[]'.
    //           * **CRITICAL:** The 'options' array MUST NOT be empty unless the question type is explicitly "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", or "Other".
    //       4.  **Correct Answer Determination:**
    //           * If a clear correct answer is explicitly present on the page (e.g., a circled option, an explicit answer in a table, or solved working visibly shown on the page for a mathematical problem), extract that answer.
    //           * For question types "MCQ" or "Problem_Solving" (where options are extracted or generated): The 'correct_answer' string MUST EXACTLY MATCH one of the strings within the 'options' array.
    //           * For question types "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", or "Other": If an explicit textual solution is provided on the page, extract that text into 'correct_answer'. If no explicit solution is given on the page, set 'correct_answer: "N/A"'. Do not guess for these types.
    //       5.  **Diagrams and Tables:**
    //           * For any visual elements (diagrams, graphs, charts, images) that are part of a question's context or a standalone visual on the page, provide a "diagram_description" and an array of "diagram_bounding_boxes".
    //           * **STAMP: REVISED DIAGRAM BOUNDING BOX INSTRUCTION FOR SINGLE, ENCOMPASSING BOX.**
    //           * "diagram_bounding_boxes" MUST contain **EXACTLY ONE** object: '{"x_min": number, "y_min": number, "x_max": number, "y_max": number}'. This single bounding box MUST encompass the **entire main diagram or visual element** on the page. It should include visible labels and ensure a generous whitespace padding (e.g., at least 5% of diagram height/width or a minimum of 20-30 pixels) around the visual content, especially vertically, to prevent cropping issues. Horizontally, it can extend to the page edges if needed. For tables, provide the single overall bounding box for the entire table with similar padding. If there are **multiple distinct main diagrams** on the page, create a separate entry in the "diagram_info" array for *each* of them, and each entry will have its own single, overall bounding box. If no diagram or table is present, return an empty array '[]'.
    //           * If a visual is a table that provides data for questions, it MUST have "is_table: true" and its "diagram_bounding_boxes".
    //           * If a table is used *as options* within an MCQ (e.g., a classification question where options are presented in rows/columns), treat these rows/columns as options in the "options" array, and do NOT include them in "diagram_info" (unless the table itself is also a primary diagram for the question, then include it but note it's also acting as options).
    //       6.  **Sub-Question Grouping:**
    //           * If a question has a main descriptive text/diagram (e.g., 'The diagram below shows...', 'The following table shows...') followed by sub-questions (a), (b), (c) that refer to that main text/diagram (e.g., Q8, Q9, Q10 in 'P6 done ACS_Primary 2 3.02.04 AM.pdf'), then:
    //               * Create *one* question object for the main question block.
    //               * Populate "main_question_text" with the common description.
    //               * Place each sub-question (a), (b), (c) as separate objects within the "parts" array, each with its "part_id", "type", "question_text", "options" (if MCQ), and "correct_answer".
    //               * "diagram_info" should be at the main question object level if it applies to all parts.
    //           * If questions are distinct and sequentially numbered (e.g., 1, 2, 3...) with no shared stem, create separate question objects for each, and their "parts" array will contain a single entry with '"part_id": "main"'.
    //       7.  **Individual Instructions:** If a text block provides instructions for a *set* of questions (e.g., 'Questions 1 to 5 carry 2 marks each.'), capture this text in the "individual_instructions" property of the *first question object* it applies to.

    //       **Provided Text (OCR Output for page ${pageNum}):**
    //       ${text}

    //       **Image Context:**
    //       [The image of the page itself will be provided alongside this text via the multimodal API input. Gemini will use its visual understanding in conjunction with the OCR text.]

    //       Now, based on the above comprehensive instructions and the text, please provide the JSON output. Ensure the output is a single, valid JSON object following the specified structure.
    //       `,
    //   },
    // ];
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
    
          **Question **
            For each distinct question , extract the following details. Don't extract any handwritten text, markings, or calculations. Focus solely on printed content and that appears to be  question.
    
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
                "main_question_text": "string", // The common text/stem for questions with multiple sub-parts (e.g., "The diagram below shows..."). it's a single question then that question text will be provided. And if its a question with multiple subpart than the stem will be provided here.
       "diagram_info": [ // Array of diagrams/visuals associated with this question block or its main context. Empty array if no diagrams.
        {
          "diagram_description": "string", // A brief, actionable description of the visual for an image generation model. Include labeled parts where relevant (e.g., "Diagram of human digestive system with parts A, B, C, D labeled").
    
        "diagram_bounding_boxes": [], // CRITICAL: This array MUST contain **EXACTLY ONE** object representing the **overall bounding box** for the *entire* main diagram or visual of a partucular question. The box should encompass the full diagram by ensuring  no parts are cut off.  For tables (if question diagram is a table), provide the single overall bounding box for the entire table, . If there are **multiple distinct main diagrams** on the page, create a separate entry in the "diagram_info" array for *each* of them, and each entry will have its own single, overall bounding box. If no diagram or table is present, return an empty array []. Example: [{"x_min": 100, "y_min": 200, "x_max": 700, "y_max": 800}]
    
        "position": "string | null" // , e.g., "top-left", "center", "bottom-right"
          "is_table": "boolean", // True if the visual is identified as a table that provides data for questions.
          "page_number": "string", // The page number where this specific visual is found (e.g., "01", "02"). Always provide.
          "diagram_img_url": "null" // Placeholder, will be filled by backend after imgbb upload.
        }
      ],
         "parts": [ // Array of question parts. If a single question, it will contain one part with "part_id": "main".
                  {
                    "part_id": "string", // Identifier for the part (e.g., "a", "b", "c" or "main" for single questions).
                    "type": "string", // Shorthanded: "MCQ", "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", "Problem_Solving", "Other".
                    "question_text": "string", // The full text of this specific question part. For activities, this is the activity's main instruction/description. null if it is a single question cause question text was already given in main_question_text 
               "options": [], // Array of strings.
                                     // - If question type is "MCQ" AND options are provided in the OCR text: Extract the string content only (remove numbering/lettering like "1)", "A)").
                                     // - If question type is "MCQ" AND NO options are provided in the OCR text: Generate 4 plausible options, where one is the correct answer and three are incorrect distractor options. Ensure options are simple strings (no numbering/lettering).
                                     // - If question type is "Problem_Solving" AND NO options are provided in the OCR text: Calculate the answer, then generate 4 plausible options (1 correct, 3 incorrect distractors) that are related to the question's context. Ensure options are simple strings (no numbering/lettering).
                                     // - For "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", "Other" types: This array MUST be empty [].
                                     // The options array MUST NOT be empty unless the question type is , "Activity", "Table_Interp", "Drawing_Labeling", or "Other".
                      "correct_answer": "string | null", // The correct option text.
                                         // - If question type is "MCQ" or "Problem_Solving" (where options are extracted or generated): This MUST be the exact string of the correct option found within the 'options' array.
                                         // - For "SAQ": If an explicit answer is given on the page, extract that text. If not, return "N/A".
                                         // - For "Activity", "Table_Interp", "Drawing_Labeling", "Other" types: Return "N/A".
    
                  }
                ]
              }
            ]
          }
          \`\`\`
    
          **Specific Instructions & Considerations:**
    
          1.  **Handwritten Text:** Explicitly ignore any handwritten text, markings, or calculations. Focus solely on printed content. Also keep this in mind while giving bounding boxes for questions
          2.  **Question Types:**
              * **"MCQ" (Multiple Choice Question):** Has a question, specific options (A, B, C, D, or 1, 2, 3, 4).
              * **"SAQ" (Short Answer Question):** Requires a brief textual answer.
              * **"Activity" (Activity/Instruction):** Describes a task or experiment, often with steps, without a specific answer format, or asks for observation/explanation. Treat "Activity 1", "Activity 2", etc., as primary question blocks. Their introductory text (e.g., "ACTIVITY 1 (8 marks) Materials given: ... Instructions: ...") should be the 'main_question_text' or part of the first 'question_text' in the 'parts' array. 
              * **"Table_Interp" (Table/Data Interpretation):** Involves extracting data from a table or interpreting data from a graph/chart.
              * **"Drawing_Labeling" (Drawing/Labeling):** Asks the user to draw something or label parts of a diagram.
              * **"Problem_Solving" (Problem Solving):** Typically involves calculations or logical deduction, common in Math papers.
              * **"Other":** For anything not fitting the above.
            3.  **Options Generation:**
                * If question type is "MCQ" AND options are provided in the OCR text: Extract the string content only (remove numbering/lettering like "1)", "A)").
                * If question type is "MCQ" AND NO options are provided in the OCR text: Generate 4 plausible options, where one is the correct answer and three are incorrect distractor options. Ensure options are simple strings (no numbering/lettering).
                * If question type is "Problem_Solving" AND NO options are provided in the OCR text: Calculate the answer, then generate 4 plausible options (1 correct, 3 incorrect distractors) that are related to the question's context. Ensure options are simple strings (no numbering/lettering).
                * For "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", "Other" types: This array MUST be empty [].
                * The options array MUST NOT be empty unless the question type is "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", or "Other".
            4.  **Correct Answer Determination:**
                * If a clear correct answer is explicitly present on the page (e.g., a circled option, an explicit answer in a table, or solved working visibly shown on the page for a mathematical problem), extract that answer.But while giving bounding box for questions don't include the answer or any other handwritten text.
                * For question types "MCQ" or "Problem_Solving" (where options are extracted or generated): This MUST be the exact string of the correct option found within the 'options' array.
                * For "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", "Other" types: If an explicit textual solution is provided on the page, extract that text into 'correct_answer'. If no explicit solution is given on the page, set 'correct_answer: "N/A"'. Do not guess for these types. You should only scan handwritten text for options generation and for correct answer determination. But while giving bounding box for questions don't include the answer or any other handwritten text.
          5.  **Diagrams and Tables:**
              * For any visual elements (diagrams, graphs, charts, images) that are part of a question's context or , provide a "diagram_description" and an array of "diagram_bounding_boxes".
              * "diagram_bounding_boxes" : This array MUST contain **EXACTLY ONE** object representing the **overall bounding box** for the *entire* main diagram or visual for a spesific question. The box should encompass the full diagram by ensuring no parts are cut off.  For tables, provide the single overall bounding box for the entire table,. If there are **multiple distinct main diagrams** on the page, create a separate entry in the "diagram_info" array for *each* of them, and each entry will have its own single, overall bounding box. If no diagram or table is present, return an empty array []. Example: [{"x_min": 100, "y_min": 200, "x_max": 700, "y_max": 800}]
              * If a visual is a table that provides data for questions, set "is_table: true".
              * If a table is used *as options* within an MCQ (e.g., a classification question where options are presented in rows/columns), treat these rows/columns as options in the "options" array, and do NOT include them in "diagram_info" (unless the table itself is also a primary diagram for the question, then include it but note it's also acting as options).
          6.  **Sub-Question Grouping:**
              * If a question has a main descriptive text/diagram (e.g., "The diagram below shows...", "The following table shows...") followed by sub-questions (a), (b), (c) that refer to that main text/diagram , then:
                  * Create *one* question object for the main question block.
                  * Populate "main_question_text" with the common description.
                  * Place each sub-question (a), (b), (c) as separate objects within the "parts" array, each with its "part_id", "type", ""question_text, "options" (if MCQ), and "correct_answer".
                  * "diagram_info" should be at the main question object level if it applies to all parts.
              * If questions are distinct and sequentially numbered (e.g., 1, 2, 3...) with no shared stem, create separate question objects for each, and their "parts" array will contain question_text as null cause question text were already provided in "main_question_text".
          7.  **Individual Instructions:** If a text block provides instructions for a *set* of questions (e.g., "Questions 1 to 5 carry 2 marks each."), capture this text in the "individual_instructions" property of the *first question object* it applies to.
    
          **Provided Text (OCR Output for page ${pageNum}):**
          ${text}
    
          **Image Context:**
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
      model: "gemini-2.5-flash-preview-05-20",
      contents: [{ role: "user", parts: geminiContents }],
      generationConfig: {
        responseMimeType: "application/json", 
      },
    });
    // console.log(response.text);
    const responseJsonString = response.text.slice(7, -3); // Remove the "```json" and "```" from the start and end
    let cleanedJsonString = responseJsonString
      .replace(/```json\n?|```/g, "")
      .trim();
    // let parsedPageContent = JSON.parse(cleanedJsonString);

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
    // const pageImagePath = `pages/page-${formattedPageNum}.jpg`;

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
