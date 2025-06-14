//importing required constants and modules
const express = require("express");
require("dotenv").config();
const cors = require("cors");
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
const {
  cleanUpPreviousData,
  deletePdfAfterProcessing,
} = require("./utils/cleanUpPreviousData");
const app = express();

//initiating gemini api
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// middlewares
const corsOptions = {
  origin: ["http://localhost:5173","https://quiz-digitizer.netlify.app/"],
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(logger);

// CRUD
app.post("/digitalize/process-pdf", upload.single("pdf"), async (req, res) => {
  try {
    cleanUpPreviousData();

    // *✅  step 1: getting pdf file from frontend (performed in pdfUploadMulter.js middlewares)
    if (!req.file) {
      return res.status(400).send("No file uploaded");
    }

    //* ✅ step 2: converting pdf to image using pdf-poppler

    const filePath = req.file.path;

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
                                         //also create options for subpart (that if parts has multiple array each array must have options)
    
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
                  * Place each sub-question (a), (b), (c) as separate objects within the "parts" array, each with its "part_id", "type", ""question_text, "options" , and "correct_answer".
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
        );
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-05-20",
        contents: [{ role: "user", parts: geminiContents }],
        generationConfig: {
          responseMimeType: "application/json",
        },
      });

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
    deletePdfAfterProcessing(); // Deleting the PDF file after processing
    res.json(finalQuestions); // Sending the final questions as a response
  } catch (error) {
    console.error(" Error processing PDF:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// getting all data
app.get("/get-all-data", async (req, res) => {
  try {
    const allData = await questionCollection.find({}).toArray();
    res.json(allData);
  } catch (error) {
    console.error(" Error fetching data:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/", (req, res) => {
  res.send("🔥 quiz digitizer server is running");
});

module.exports = app;
