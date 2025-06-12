const geminiContents = [
    {
      text: `
      **CRITICAL INSTRUCTION: Your entire output MUST be a single, perfectly valid JSON object. DO NOT include any comments, explanations, or extraneous text outside or inside the JSON object. All property names and string values MUST be enclosed in double-quotes. Strictly adhere to JSON syntax (e.g., no trailing commas, no single quotes, no undefined/NaN values).**
  
      You are an expert educational content extractor. Your task is to process the provided image (of a worksheet page) and its OCR text. Your goal is to digitize the content into a structured JSON format suitable for building interactive quizzes.
      
      **High-Level Document Metadata Extraction:**
      From the current page, especially if it appears to be a cover page or a primary information page, extract the following overall document details. If not found, return 'null'.
      - "institution_name": "string" (e.g., "AI TONG SCHOOL", "Anglo-Chinese School")
      - "exam_name": "string" (e.g., "Science Practical Assessment 2024", "2023 P6 PRELIMINARY EXAM", "2024 Term 2 Review")
      - "subject": "string" (e.g., "Science", "MATHEMATICS")
      - "paper": "string" // (e.g., "Paper 1", "Paper 2", "Paper 3"). Null if not specified.
      - "class_name": "string" // (e.g., "Primary 4", "P6")
      - "exam_duration": "string" // (e.g., "40 minutes", "1 hour 30 minutes"). Null if not specified.
      - "global_instructions": "string | null" // Extract any document-wide instructions (e.g., "INSTRUCTIONS TO CANDIDATES"). Combine multi-line instructions into a single string. Null if not present.
      
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
            "id": "string",
            "individual_instructions": "string | null",
            "main_question_text": "string | null",
            "diagram_info": [
              {
                "diagram_description": "string",
                "diagram_bounding_boxes": [],
                "is_table": "boolean",
                "page_number": "string",
                "diagram_img_url": "null"
              }
            ],
            "parts": [
              {
                "part_id": "string",
                "type": "string",
                "question_text": "string",
                "options": [],
                "correct_answer": "string | null",
                "page_number": "string"
              }
            ]
          }
        ]
      }
      \`\`\`
      
      **Specific Instructions & Considerations:**
      
      1.  **Handwritten Text:** Explicitly ignore any handwritten text, markings, or calculations. Focus solely on printed content.
      2.  **Question Types:**
          * "MCQ" (Multiple Choice Question): Has a question, specific options (A, B, C, D, or 1, 2, 3, 4).
          * "SAQ" (Short Answer Question): Requires a brief textual answer.
          * "Activity" (Activity/Instruction): Describes a task or experiment, often with steps, without a specific answer format, or asks for observation/explanation. Treat "Activity 1", "Activity 2", etc., as primary question blocks. Their introductory text (e.g., "ACTIVITY 1 (8 marks) Materials given: ... Instructions: ...") should be the 'main_question_text' or part of the first 'question_text' in the 'parts' array.
          * "Table_Interp" (Table/Data Interpretation): Involves extracting data from a table or interpreting data from a graph/chart.
          * "Drawing_Labeling" (Drawing/Labeling): Asks the user to draw something or label parts of a diagram.
          * "Problem_Solving" (Problem Solving): Typically involves calculations or logical deduction, common in Math papers.
          * "Other": For anything not fitting the above.
      3.  **Options Generation:**
          * If a question's `type` is "MCQ" AND options are provided in the OCR text (e.g., "1) Digestion is complete", "A. Some option"), **extract only the string content**, removing any leading numbers or letters (e.g., "Digestion is complete", "Some option"). Populate these into the `options` array.
          * If a question's `type` is "MCQ" AND **NO options are provided** in the OCR text for that question: You **MUST generate 4 plausible options**. One option should be the correct answer based on the question text, and the other three should be incorrect but reasonable distractors. Ensure these generated options are clear strings, **without any numbering or lettering**.
          * If a question's `type` is "Problem_Solving" AND **NO options are provided** in the OCR text for that question: You **MUST calculate the correct answer** based on the problem presented. Then, generate 4 plausible options related to the problem (1 correct, 3 incorrect distractors). Ensure these generated options are clear strings, **without any numbering or lettering**.
          * For question types "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", or "Other": The `options` array MUST be empty `[]`.
          * **CRITICAL:** The `options` array MUST NOT be empty unless the question type is explicitly "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", or "Other".
      4.  **Correct Answer Determination:**
          * If a clear correct answer is explicitly present on the page (e.g., a circled option, an explicit answer in a table, or solved working visibly shown on the page for a mathematical problem), extract that answer.
          * For question types "MCQ" or "Problem_Solving" (where options are extracted or generated): The `correct_answer` string MUST EXACTLY MATCH one of the strings within the `options` array.
          * For question types "SAQ", "Activity", "Table_Interp", "Drawing_Labeling", or "Other": If an explicit textual solution is provided on the page, extract that text into `correct_answer`. If no explicit solution is given on the page, set `correct_answer: "N/A"`. Do not guess for these types.
      5.  **Diagrams and Tables:**
          * For any visual elements (diagrams, graphs, charts, images) that are part of a question's context or a standalone visual on the page, provide a "diagram_description" and an array of "diagram_bounding_boxes".
          * "diagram_bounding_boxes" MUST contain precise pixel coordinates for *each significant visual element* identified as part of a diagram or standalone image. If multiple distinct visual elements are part of one diagram (e.g., an image and its associated text labels that are separated), provide a bounding box for *each* element. The format must be an array of objects: `[{"x_min": number, "y_min": number, "x_max": number, "y_max": number}, {"x_min": ..., "y_min": ..., "x_max": ..., "y_max": ...}]`. If no diagram is present, this array should be empty `[]`.
          * If a visual is a table that provides data for questions, it MUST have "is_table: true" and its "diagram_bounding_boxes".
          * If a table is used *as options* within an MCQ (e.g., a classification question where options are presented in rows/columns), treat these rows/columns as options in the "options" array, and do NOT include them in "diagram_info" (unless the table itself is also a primary diagram for the question, then include it but note it's also acting as options).
      6.  **Sub-Question Grouping:**
          * If a question has a main descriptive text/diagram (e.g., "The diagram below shows...", "The following table shows...") followed by sub-questions (a), (b), (c) that refer to that main text/diagram (e.g., Q8, Q9, Q10 in "P6 done ACS_Primary 2 3.02.04 AM.pdf"), then:
              * Create *one* question object for the main question block.
              * Populate "main_question_text" with the common description.
              * Place each sub-question (a), (b), (c) as separate objects within the "parts" array, each with its "part_id", "type", "question_text", "options" (if MCQ), and "correct_answer".
              * "diagram_info" should be at the main question object level if it applies to all parts.
          * If questions are distinct and sequentially numbered (e.g., 1, 2, 3...) with no shared stem, create separate question objects for each, and their "parts" array will contain a single entry with '"part_id": "main"'.
      7.  **Individual Instructions:** If a text block provides instructions for a *set* of questions (e.g., "Questions 1 to 5 carry 2 marks each."), capture this text in the "individual_instructions" property of the *first question object* it applies to.
      
      **Provided Text (OCR Output for page ${pageNum}):**
      ${ocrText}
      
      **Image Context:**
      [The image of the page itself will be provided alongside this text via the multimodal API input. Gemini will use its visual understanding in conjunction with the OCR text.]
      
      Now, based on the above comprehensive instructions and the text, please provide the JSON output. Ensure the output is a single, valid JSON object following the specified structure.
      `,
    },
  ];