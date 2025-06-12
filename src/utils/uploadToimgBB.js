const fs = require("fs");
const axios = require("axios");
const qs = require("qs");

const uploadToImgBB = async (filePath) => {
  try {
    const base64Image = fs.readFileSync(filePath, { encoding: "base64" });

    if (!base64Image) {
      throw new Error("Image file is empty or unreadable");
    }

    const response = await axios.post(
      `https://api.imgbb.com/1/upload?key=${process.env.IMG_BB_API_KEY}`,
      qs.stringify({ image: base64Image }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    return response.data.data.url;
  } catch (error) {
    console.error("ImgBB Upload Error:", error.response?.data || error.message);
    throw error;
  }
};

module.exports = uploadToImgBB;
