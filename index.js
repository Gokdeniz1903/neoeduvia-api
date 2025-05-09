const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { Document, Packer, Paragraph, TextRun } = require("docx");
require("dotenv").config();
const { OpenAI } = require("openai");

const app = express();
const PORT = process.env.PORT || 10000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 📂 Statik klasörler
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/history", express.static(path.join(__dirname, "history")));

app.use(cors());
app.use(express.json());

// 📂 uploads klasörü yoksa oluştur
const uploadPath = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath);
}

// 📂 history klasörü yoksa oluştur
const historyPath = path.join(__dirname, "history");
if (!fs.existsSync(historyPath)) {
  fs.mkdirSync(historyPath);
}

const upload = multer({ dest: "uploads/" });

app.post("/api/convert", upload.single("file"), async (req, res) => {
  try {
    let inputText = req.body.text || "";
    const mode = req.body.mode || "Kısa ve öz özetle";

    // 1. Dosya varsa işle
    if (req.file) {
      const filePath = path.join(__dirname, req.file.path);
      const ext = path.extname(req.file.originalname).toLowerCase();

      if (ext === ".pdf") {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        inputText = data.text;
      } else if (ext === ".docx" || ext === ".doc") {
        const data = await mammoth.extractRawText({ path: filePath });
        inputText = data.value;
      } else {
        return res.status(400).json({ error: "Sadece PDF ve Word dosyaları desteklenir." });
      }

      fs.unlinkSync(filePath); // geçici dosyayı sil
    }

    if (!inputText.trim()) {
      return res.status(400).json({ error: "Boş metin gönderilemez." });
    }

    // 2. OpenAI prompt
    const prompt = `${mode}:\n\n${inputText.slice(0, 4000)}`;
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    });

    const output = completion.choices[0].message.content;

    // 3. DOCX dosyası oluştur
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [new Paragraph({ children: [new TextRun(output)] })],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `output-${Date.now()}.docx`;
    const filePath = path.join(historyPath, filename);
    fs.writeFileSync(filePath, buffer);

    // 4. Yanıt gönder
    res.json({
      completion: output,
      downloadUrl: `/history/${filename}`,
    });

  } catch (err) {
    console.error("❌ Hata:", err);
    res.status(500).json({ error: "Sunucu hatası: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Sunucu çalışıyor: http://localhost:${PORT}`);
});
