const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const OpenAI = require("openai");
const { Document, Packer, Paragraph, TextRun } = require("docx");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 📂 MP3 ve DOCX çıktılar için statik klasörler
app.use("/audio", express.static("uploads"));
app.use("/history", express.static("history"));

app.post("/api/convert", upload.single("file"), async (req, res) => {
  try {
    const mode = req.body.mode || "Metinleştir";
    let content = "";

    // 🔹 1. Metin girilmişse onu kullan
    if (req.body.text) {
      content = req.body.text;
    }

    // 🔹 2. Dosya varsa içeriğini oku
    else if (req.file) {
      const filePath = req.file.path;
      const mime = req.file.mimetype;

      if (mime === "application/pdf") {
        const buffer = fs.readFileSync(filePath);
        const parsed = await pdfParse(buffer);
        content = parsed.text;
      } else if (
        mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        const parsed = await mammoth.extractRawText({ path: filePath });
        content = parsed.value;
      } else {
        return res.status(415).json({ error: "Sadece PDF ve Word dosyaları destekleniyor." });
      }

      fs.unlinkSync(filePath); // geçici dosyayı sil
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: "İçerik boş." });
    }

    // 🔊 Podcast TTS
    if (mode === "Podcast senaryosu yap") {
      if (content.length > 4096) {
        content = content.slice(0, 4096);
      }

      const speech = await openai.audio.speech.create({
        model: "tts-1",
        voice: "nova",
        input: content,
      });

      const buffer = Buffer.from(await speech.arrayBuffer());
      const filename = `output-${Date.now()}.mp3`;
      fs.writeFileSync(`./uploads/${filename}`, buffer);

      return res.json({
        audioUrl: `/audio/${filename}`,
        originalText: content,
      });
    }

    // 🖼️ Görsel (DALL·E)
    if (mode === "Görsel olarak tarif et") {
      const dallePrompt = `Aşağıdaki konuyu DALL·E tarafından çizilebilir şekilde tarif et.
Diyagram, kavram haritası, semboller ve açıklayıcı etiketler içerecek biçimde tanımla:
\n${content}`;

      const dalleResult = await openai.images.generate({
        prompt: dallePrompt,
        n: 1,
        size: "1024x1024",
      });

      const imageUrl = dalleResult.data[0].url;
      return res.json({ imageUrl });
    }

    // 🧠 GPT Metin Modları
    let prompt = "";

    if (mode === "Hikayeye dönüştür") {
      prompt = `Aşağıdaki metni kısa, duygusal ve anlamlı bir hikâyeye dönüştür:\n${content}`;
    } else if (mode === "Kısa ve öz özetle") {
      prompt = `Aşağıdaki metni kısa, sade ve maddeler halinde özetle:\n${content}`;
    } else {
      prompt = `${mode}: ${content}`;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    });

    const output = completion.choices[0].message.content;

    // 📝 DOCX dosyası oluştur
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: output,
                  font: "Arial",
                  size: 24,
                }),
              ],
            }),
          ],
        },
      ],
    });

    const docxBuffer = await Packer.toBuffer(doc);
    const docxFilename = `output-${Date.now()}.docx`;
    fs.writeFileSync(`./history/${docxFilename}`, docxBuffer);

    res.json({
      completion: output,
      downloadUrl: `/history/${docxFilename}`,
    });

  } catch (err) {
    console.error("GENEL HATA:", err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

app.listen(port, () => {
  console.log(`✅ Sunucu çalışıyor: http://localhost:${port}`);
});
