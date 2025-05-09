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

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/history", express.static(path.join(__dirname, "history")));

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("history")) fs.mkdirSync("history");

const upload = multer({ dest: "uploads/" });

app.post("/api/convert", upload.single("file"), async (req, res) => {
  try {
    let inputText = req.body.text || "";
    const mode = req.body.mode || "Kısa ve öz özetle";

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

      fs.unlinkSync(filePath);
    }

    if (!inputText.trim()) {
      return res.status(400).json({ error: "Boş metin gönderilemez." });
    }

    let finalText = "";
    let audioUrl = null;

    // 🔉 Podcast
    if (mode === "Podcast senaryosu yap") {
      const lineCount = inputText.split("\n").length;
      const avgLineLength = inputText.length / lineCount;
      const isLikelySlides = lineCount >= 8 && avgLineLength < 80;

      if (isLikelySlides) {
        const conversionPrompt = `Aşağıdaki slayt tarzı metni sade, doğal bir anlatımla bir konuşma gibi yeniden düzenle:\n\n${inputText.slice(0, 4000)}`;
        const conversion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: conversionPrompt }],
        });
        finalText = conversion.choices[0].message.content;
      } else {
        finalText = inputText.slice(0, 4000);
      }

      const speechResponse = await openai.audio.speech.create({
        model: "tts-1",
        voice: "nova",
        input: finalText,
      });

      const audioFilename = `podcast-${Date.now()}.mp3`;
      const audioPath = path.join(__dirname, "history", audioFilename);
      const buffer = Buffer.from(await speechResponse.arrayBuffer());
      fs.writeFileSync(audioPath, buffer);
      audioUrl = `https://neoeduvia-api.onrender.com/history/${audioFilename}`;
    }

    // 🧠 Bilişsel Metinleştirme
    else if (mode === "Bilişsel Metinleştirme") {
      const prompt = `
Aşağıdaki metni öğrencinin anlamlı öğrenmesini kolaylaştıracak şekilde yeniden yaz:
- Girişe kısa bir özet ekle.
- Metni kavramsal bloklara ayır ve başlıklar koy.
- Anahtar kavramları **kalın** yap.
- Gerekirse hatırlatıcı kutular (örneğin: "Unutma:", "Örnek:") ekle.
- Akademik ama sade bir dil kullan.

Metin:
${inputText.slice(0, 4000)}
      `;

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
      });

      finalText = completion.choices[0].message.content;
    }

    // 📖 Hikayeleştirme
    else if (mode === "Hikayeye Dönüştür") {
      const prompt = `
Öğrencinin yaşadığı bir olayla başla. Konuya bu bağlamda geçiş yap.
Aşağıdaki metni bir öğrencinin günlük hayatına entegre ederek bir hikâyeye dönüştür. 
Karakter bu kavramları öğrenmeye çalışsın ve örneklerle anlamaya çalışsın. 
Duygusal ve sade bir dille yaz. Metin 450 ila 600 kelime arasında olsun.

Metin:
${inputText.slice(0, 4000)}
      `;

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
      });

      finalText = completion.choices[0].message.content;
    }

    // 📄 Diğer modlar (Özetle, Anlatıcı Dil vb.)
    else {
      const prompt = `${mode}:\n\n${inputText.slice(0, 4000)}`;
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
      });

      finalText = completion.choices[0].message.content;
    }

    const doc = new Document({
      sections: [{
        children: [new Paragraph({ children: [new TextRun(finalText)] })],
      }],
    });

    const docBuffer = await Packer.toBuffer(doc);
    const docFilename = `output-${Date.now()}.docx`;
    const docPath = path.join(__dirname, "history", docFilename);
    fs.writeFileSync(docPath, docBuffer);

    res.json({
      completion: finalText,
      downloadUrl: `https://neoeduvia-api.onrender.com/history/${docFilename}`,
      ...(audioUrl && { audioUrl }),
    });

  } catch (err) {
    console.error("❌ Hata:", err);
    res.status(500).json({ error: "Sunucu hatası: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Sunucu çalışıyor: http://localhost:${PORT}`);
});
