const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { Document, Packer, Paragraph, TextRun } = require("docx");
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json());

// 🔧 Statik klasörler
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/history", express.static(path.join(__dirname, "history")));

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("history")) fs.mkdirSync("history");

const upload = multer({ dest: "uploads/" });

app.post("/api/convert", upload.single("file"), async (req, res) => {
  try {
    let inputText = req.body.text || "";
    const mode = req.body.mode || "Kısa ve öz özetle";

    // 🔍 Dosya içeriği okunursa
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

    // ✨ GPT-3.5 ile dönüştür
    const prompt = `${mode}:\n\n${inputText.slice(0, 4000)}`;
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    });

    const output = completion.choices[0].message.content;

    // 🎧 Eğer Podcast ise → TTS üret
    let audioUrl = null;
    if (mode === "Podcast senaryosu yap") {
      const speechResponse = await openai.audio.speech.create({
        model: "tts-1",
        voice: "nova", // dilersen "onyx", "shimmer" da olabilir
        input: output.slice(0, 4000), // max 4096 karakter
      });

      const filename = `podcast-${Date.now()}.mp3`;
      const filePath = path.join(__dirname, "history", filename);
      const buffer = Buffer.from(await speechResponse.arrayBuffer());
      fs.writeFileSync(filePath, buffer);
      audioUrl = `https://neoeduvia-api.onrender.com/history/${filename}`;
    }

    // 📄 DOCX çıktı oluştur
    const doc = new Document({
      sections: [{
        children: [new Paragraph({ children: [new TextRun(output)] })],
      }],
    });

    const docBuffer = await Packer.toBuffer(doc);
    const docFilename = `output-${Date.now()}.docx`;
    const docPath = path.join(__dirname, "history", docFilename);
    fs.writeFileSync(docPath, docBuffer);

    // 🎯 Yanıtla
    res.json({
      completion: output,
      downloadUrl: `https://neoeduvia-api.onrender.com/history/${docFilename}`,
      ...(audioUrl && { audioUrl }), // varsa ekle
    });

  } catch (err) {
    console.error("❌ Hata:", err);
    res.status(500).json({ error: "Sunucu hatası: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Sunucu çalışıyor: http://localhost:${PORT}`);
});
