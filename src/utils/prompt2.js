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
  - I want to capture the horizontal space fullly, so the bounding box should be wide enough to cover the entire page. ANd you need to capture the vertical space carefully, so the bounding box should be tall enough not to crop out any required portion of the diagram.
  - Do not return multiple partial boxes or fragmented visuals.
  - If no diagram, leave the array empty.
  
  📄 Metadata (can be null if not found):
  - "institution_name", "exam_name", "subject", "paper", "class_name", "exam_duration", "global_instructions"
  -"global_instructions" must be an array of strings. if a single data is found than array should contain that single data.
  
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
