cconst express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const OpenAI = require("openai");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/api/convert", upload.single("file"), async (req, res) => {
  try {
    const mode = req.body.mode || "Metinleştir";
    let content = "";

    // 1. Metin kutusu varsa al
    if (req.body.text) {
      content = req.body.text;
    }
    // 2. Dosya varsa oku
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
        return res.status(415).json({ error: "Yalnızca PDF veya Word dosyası yükleyebilirsiniz." });
      }

      fs.unlinkSync(filePath); // dosyayı sil
    } else {
      return res.status(400).json({ error: "Metin veya dosya bulunamadı." });
    }

    // 🔊 Podcastleştirme modu → doğrudan seslendir
    if (mode === "Podcast senaryosu yap") {
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

    // Diğer modlar → sadece metin (GPT)
    const prompt = `${mode}: ${content}`;
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    });

    const output = completion.choices[0].message.content;
    res.json({ completion: output });

  } catch (err) {
    console.error("HATA:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// Statik ses dosyası erişimi
app.use("/audio", express.static("uploads"));

app.listen(port, () => {
  console.log(`Sunucu çalışıyor: http://localhost:${port}`);
});
