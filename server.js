const app = require("./src/app");
const { connectDB } = require("./src/utils/connectDB");
const port = process.env.PORT || 5000;

require("dotenv").config();


connectDB().then(()=>{
  app.listen(port, () => {
    console.log(`🚩 quiz digitizer server is running on port ${port}`);
    console.log(`✅ Connected to MONGODB`);
  });
})

