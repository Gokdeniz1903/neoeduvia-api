const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { Configuration, OpenAIApi } = require("openai");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const openai = new OpenAIApi(
  new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  })
);

app.post("/api/convert", upload.single("file"), async (req, res) => {
  try {
    const mode = req.body.mode || "Özetle";
    let content = "";

    if (req.body.text) {
      content = req.body.text;
    } else if (req.file) {
      const filePath = req.file.path;
      const mime = req.file.mimetype;

      if (mime === "application/pdf") {
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        content = pdfData.text;
      } else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        const docData = await mammoth.extractRawText({ path: filePath });
        content = docData.value;
      } else {
        content = "Desteklenmeyen dosya türü.";
      }

      fs.unlinkSync(filePath); // Dosyayı sil
    } else {
      return res.status(400).json({ error: "Hiçbir içerik alınamadı." });
    }

    const prompt = `${mode}: ${content}`;

    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    });

    const output = completion.data.choices[0].message.content;
    res.json({ completion: output });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

app.listen(port, () => {
  console.log(`API çalışıyor: http://localhost:${port}`);
});
