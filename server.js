const express = require('express');
const cors = require('cors');
const port=process.env.PORT || 5000;


const app=express()

// middlewares
app.use(cors())
app.use(express.json())

app.get("/",(req,res)=>{
    res.send("🔥 quiz digitizer server is running")
})

app.listen(port,()=>{
    console.log(`✅ quiz digitizer server is running on port ${port}`)
})