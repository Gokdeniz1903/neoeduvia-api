const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { OpenAI } = require("openai");
const { Document, Packer, Paragraph, TextRun } = require("docx");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/history", express.static(path.join(__dirname, "history")));

const upload = multer({ dest: "uploads/" });

app.post("/api/convert", upload.single("file"), async (req, res) => {
  try {
    let inputText = req.body.text || "";
    const mode = req.body.mode || "Kısa ve öz özetle";

    // 1. Dosya varsa işlenir
    if (req.file) {
      const filePath = path.join(__dirname, req.file.path);
      const fileExt = path.extname(req.file.originalname).toLowerCase();

      if (fileExt === ".pdf") {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        inputText = data.text;
      } else if (fileExt === ".docx" || fileExt === ".doc") {
        const data = await mammoth.extractRawText({ path: filePath });
        inputText = data.value;
      } else {
        return res.status(400).json({ error: "Desteklenmeyen dosya türü." });
      }

      fs.unlinkSync(filePath); // temp dosyayı sil
    }

    if (!inputText.trim()) {
      return res.status(400).json({ error: "Metin boş olamaz." });
    }

    // 2. OpenAI prompt hazırlanır
    const prompt = `${mode}:\n\n${inputText.trim().slice(0, 4000)}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    });

    const output = completion.choices[0].message.content;

    // 3. DOCX çıktısı hazırlanır
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              children: [new TextRun(output)],
            }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `output-${Date.now()}.docx`;
    const filePath = path.join(__dirname, "history", filename);
    fs.writeFileSync(filePath, buffer);

    // 4. Yanıt döndürülür
    res.json({
      completion: output,
      downloadUrl: `/history/${filename}`,
    });

  } catch (err) {
    console.error("Sunucu hatası:", err);
    res.status(500).json({ error: "Sunucu hatası: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Sunucu çalışıyor: http://localhost:${PORT}`);
});
