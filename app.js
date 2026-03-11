import express from "express";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const app = express();

// serve static files
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

export default app;
