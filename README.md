<div align="center">
  <img height="400" src="https://github.com/shahbaz-kamal/quiz-digitizer-server/blob/main/src/assets/github_banner.JPG"  />
</div>

###

<h1 align="left">📚 Quiz Digitizer - Server 🧠</h1>

###

<p align="left">Quiz Digitizer - Backend API is an intelligent Node.js server that transforms scanned educational PDFs into structured, interactive quiz data. It leverages Tesseract.js for OCR to extract printed text from each page, and integrates with the Gemini 1.5 Flash API to classify question types (MCQ, SAQ, Activities, Tables, etc.), extract correct answers, and detect diagrams with precise bounding boxes. Using Sharp, the backend crops diagrams from converted PDF pages (handled via pdf-poppler) and uploads them to ImgBB, embedding the hosted image URLs directly into the JSON output. The system supports high-DPI PDF-to-image conversion, automated file cleanup, and MongoDB for persistent storage. Designed with Express.js, it provides a clean RESTful API that makes digitizing and analyzing traditional worksheets seamless and AI-assisted.</p>

###

## 🔗 Frontend Githup repo

<p align="left">https://github.com/shahbaz-kamal/quiz-digitizer-client.git</p>

<!-- ###
<!-- ## 👨‍💼 Admin Info
###
<p align="left">Admin Email: shahbaz@kamal.com</p>
<p align="left">Admin Password: 123456Aa</p> -->

## ✨ Features:

###

1. **📄 PDF Upload Handling**

   - Accepts PDF files via a POST endpoint and processes them page-by-page.

2. **🖼️ PDF to High-Resolution Image Conversion**

   - Converts each page to high-DPI JPEG images using `pdf-poppler`.

3. **🧠 Text Extraction with OCR**

   - Uses `Tesseract.js` to extract printed content from each page.

4. **🤖 AI-Powered Quiz Structuring (Gemini 1.5 Flash)**

   - Classifies question types (MCQ, SAQ, Activities, etc.)
   - Extracts instructions, options, and correct answers
     -Detects diagram positions and bounding boxes intelligently

5. **✂️ Diagram Cropping with Sharp**

   - Crops diagrams using coordinates provided by Gemini or fallback heuristics (e.g., top-right, center).

6. **☁️ Image Hosting via ImgBB**

   - Uploads cropped diagrams and stores accessible image URLs inside the final quiz JSON.

7. **🧹 Automatic Cleanup**

   - Deletes old images, PDFs, and database entries before each new run to keep the workspace clean.

8. **🧾 Structured JSON Output**

   - Outputs clean JSON format for frontend use, including metadata, questions, options, answers, and diagram info.

9. **🛠️ RESTful API (Express.js)**

   - Easy integration with frontend using `/digitalize/process-pdf` POST route.re feedback.

10. **📦 MongoDB Integratio**
    - Persists processed quiz data for retrieval and reuse.

###

## 🛠 Technology Used

###

 <div align="left">
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg" height="40" alt="nodejs logo"  />
  <img width="12" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/javascript/javascript-original.svg" height="40" alt="javascript logo"  />
  <img width="12" />
  <img src="https://skillicons.dev/icons?i=express" height="40" alt="express logo"  />
  <img width="12" />
  <img src="https://raw.githubusercontent.com/Hopding/pdf-lib-docs/master/assets/logo-full.svg?sanitize=true" height="40" alt="express logo"  />
  <img width="12" />
  <img src="https://github.com/naptha/tesseract.js/blob/HEAD/docs/images/tesseract.png" height="40" alt="express logo"  />
  <img width="12" />
  <img src="https://img.icons8.com/?size=48&id=rnK88i9FvAFO&format=png" height="40" alt="express logo"  />
</div>

###

###

## 💥 Dependencies:

###

<p align="left">"@google/genai": "^1.4.0",<br>    "axios": "^1.9.0",<br>    "cors": "^2.8.5",<br>    "dotenv": "^16.5.0",<br>    "express": "^5.1.0",<br>    "mongodb": "^6.17.0",<br>    "multer": "^2.0.1",<br>    "pdf-lib": "^1.17.1",<br>    "pdf-poppler": "^0.2.1",<br>    "sharp": "^0.34.2",<br>    "tesseract.js": "^6.0.1"</p>

###

###

## 🔧 Installation Guidline:

<p align="center" style="display: flex; align-items: center; justify-content: center;">
  <span style="font-size: 20px; font-weight: bold;">Backend</span>
  <img src="https://cdn-icons-png.flaticon.com/128/16318/16318927.png" alt="Front End Icon" width="15" height="15" style="margin-left: 8px;" />
</p>

###

1. First clone the project by running

```bash
  git clone https://github.com/shahbaz-kamal/quiz-digitizer-server.git
```

2. Change your directory to the cloned folder by

```bash
  cd folder_name
```

3. Run the following to install dependencies:

```bash
npm install
```

4. Create a MongoDB user by keeping username and password collected & create a .env file in the root directory and put the following code with corresponding info's and api keys:

```bash
DB_USER=***************************
DB_PASS=***************************
GEMINI_API_KEY=********************
IMG_BB_API_KEY=********************
```

5. Run the following command and open the website locally on port 5000:

```bash
npm start
```

###

<p align="center" style="display: flex; align-items: center; justify-content: center;">
  <span style="font-size: 20px; font-weight: bold;">Front End</span>
  <img src="https://cdn-icons-png.flaticon.com/128/1055/1055666.png" alt="Front End Icon" width="15" height="15" style="margin-left: 8px;" />
</p>

1. First clone the project by running

```bash
  git clone https://github.com/shahbaz-kamal/quiz-digitizer-client.git
```

2. Change your directory to the cloned folder by

```bash
  cd folder_name
```

3. Run the following to install dependencies:

```bash
npm install
```

4. Run the following command and open the website locally on port 5173:

```bash
npm run dev
```

###
