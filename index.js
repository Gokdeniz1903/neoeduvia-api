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

app.use(cors());
app.use(express.json());

// ✅ Statik dosya servisleri
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/history", express.static(path.join(__dirname, "history"))); // 🔥 Bu kritik

// 📂 Klasörleri oluştur
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("history")) fs.mkdirSync("history");

const upload = multer({ dest: "uploads/" });

app.post("/api/convert", upload.single("file"), async (req, res) => {
  try {
    let inputText = req.body.text || "";
    const mode = req.body.mode || "Kısa ve öz özetle";

    // Dosya varsa oku
    if (req.file) {
      const filePath = path.join(__dirname, req.file.path);
      const ext = path.extname(req.file.originalname).toLowerCase();

      if (ext === ".pdf") {
        const data = await pdfParse(fs.readFileSync(filePath));
        inputText = data.text;
      } else if (ext === ".docx") {
        const data = await mammoth.extractRawText({ path: filePath });
        inputText = data.value;
      }

      fs.unlinkSync(filePath); // Geçici dosyayı sil
    }

    if (!inputText.trim()) {
      return res.status(400).json({ error: "Boş metin gönderilemez." });
    }

    // OpenAI ile yanıt al
    const prompt = `${mode}:\n\n${inputText.slice(0, 4000)}`;
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    });

    const output = completion.choices[0].message.content;

    // DOCX dosyası oluştur
    const doc = new Document({
      sections: [{
        children: [new Paragraph({ children: [new TextRun(output)] })],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `output-${Date.now()}.docx`;
    const filepath = path.join(__dirname, "history", filename);
    fs.writeFileSync(filepath, buffer); // 📁 Dosya gerçekten yazılıyor mu?

    // Yanıt
    res.json({
      completion: output,
      downloadUrl: `/history/${filename}`, // ✅ Bu path Render ile uyumlu
    });

  } catch (err) {
    console.error("❌ Sunucu hatası:", err);
    res.status(500).json({ error: "Sunucu hatası: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Sunucu çalışıyor: http://localhost:${PORT}`);
});
