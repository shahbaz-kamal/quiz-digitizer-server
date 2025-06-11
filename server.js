const express = require("express");
const cors = require("cors");
const app = require("./src/app");
const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`✅ quiz digitizer server is running on port ${port}`);
});
