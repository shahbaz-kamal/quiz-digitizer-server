const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jxshq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// databas ecollection
const db = client.db("quiz-digitizer-db");
const questionCollection = db.collection("questions");


async function connectDB() {
  return client.connect();


}
connectDB().catch(console.dir);

module.exports = { connectDB, questionCollection };
