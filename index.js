const express = require("express");
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

    // 1. Kullanıcının metin girmesi durumu
    if (req.body.text) {
      content = req.body.text;
    }

    // 2. Kullanıcının dosya yüklemesi durumu
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
        return res.status(415).json({
          error: "Yalnızca PDF veya Word dosyası yükleyebilirsiniz.",
        });
      }

      fs.unlinkSync(filePath); // temp dosyayı sil
    } else {
      return res
        .status(400)
        .json({ error: "Metin veya dosya yüklenmesi gerekiyor." });
    }

    // 🔊 Podcastleştirme → içerik seslendirilecekse
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

    // 🎨 Görsel oluşturma → içerik GPT ile görselleştirilecekse
    if (mode === "Görsel olarak tarif et") {
      const dallePrompt = `Aşağıdaki konuyu DALL·E tarafından çizilebilir şekilde tarif et. 
Diyagram, kavram haritası, semboller ve açıklayıcı etiketler içerecek biçimde tanımla. 
Konu: ${content}`;

      const dalleResult = await openai.images.generate({
        prompt: dallePrompt,
        n: 1,
        size: "1024x1024",
      });

      const imageUrl = dalleResult.data[0].url;
      return res.json({ imageUrl });
    }

    // 🧠 Diğer modlar için GPT promtları
    let prompt = "";

    if (mode === "Hikayeye dönüştür") {
      prompt = `Aşağıdaki metni kısa, duygusal ve anlamlı bir hikâyeye dönüştür. 
Giriş, gelişme ve sonuç yapısı içersin. \n${content}`;
    } else if (mode === "Kısa ve öz özetle") {
      prompt = `Aşağıdaki metni kısa, sade ve maddeler halinde özetle. 
En önemli bilgileri öne çıkar. \n${content}`;
    } else {
      prompt = `${mode}: ${content}`;
    }

    // GPT-3.5 çıktısı üret
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    });

    const output = completion.choices[0].message.content;
    res.json({ completion: output });

  } catch (err) {
    console.error("HATA:", err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// MP3 dosyaları için statik yol
app.use("/audio", express.static("uploads"));

app.listen(port, () => {
  console.log(`Sunucu çalışıyor: http://localhost:${port}`);
});
