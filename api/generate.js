const MAX_WORDS = 100;   // 한 번에 처리할 최대 단어 수
const CHUNK_SIZE = 25;   // Gemini 요청 1건당 단어 수 (작게 나눠 안정성 확보)
const MODEL = "gemini-2.5-flash";

const sleep = ms => new Promise(r => setTimeout(r, ms));

function buildPrompt(chunk, mode) {
  const wordLines = chunk
    .map(item =>
      `${item.word}|${item.synonym || ""}|${item.antonym || ""}|${item.partOfSpeech || ""}`
    )
    .join("\n");

  return `
Return JSON only.

Make English vocab cards for students. Make one card for EVERY input word (do not skip any).

Input format:
word|synonym|antonym|partOfSpeech

Rules:
- If synonym exists, use it exactly.
- If antonym exists, use it exactly.
- If partOfSpeech exists, use it exactly.
- If missing, create a simple common answer.
- definition: very easy English.
- examples: easy student sentences.
- quizSentence: 8-15 words and includes the word.
- distractors: exactly 2 wrong words.
- no Korean.
- If mode is blank, create a fresh blankSentence each time.
- blankSentence must include ____ instead of the target word.
- blankChoices must be exactly 3 wrong vocab words.

Mode: ${mode}

Return:
{
  "cards": [
    {
      "word": "",
      "partOfSpeech": "",
      "definition": "",
      "example1": "",
      "example2": "",
      "synonym": "",
      "antonym": "",
      "quizSentence": "",
      "blankSentence": "",
      "blankChoices": ["", "", ""],
      "distractors": ["", ""]
    }
  ]
}

Words:
${wordLines}
`;
}

// 일시적 오류(429/500/503)는 지수 backoff로 자동 재시도
async function callGeminiWithRetry(body, apiKey, retries = 4) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  let delay = 1000;

  for (let attempt = 0; ; attempt++) {
    let aiRes;
    try {
      aiRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (networkErr) {
      // 네트워크 자체 실패도 재시도 대상
      if (attempt < retries) {
        await sleep(delay);
        delay *= 2;
        continue;
      }
      const e = new Error("네트워크 연결에 실패했어요.");
      e.status = 503;
      e.detail = networkErr.message;
      throw e;
    }

    const data = await aiRes.json().catch(() => ({}));

    if (aiRes.ok) return data;

    const retryable = [429, 500, 503].includes(aiRes.status);
    if (retryable && attempt < retries) {
      await sleep(delay);
      delay *= 2;
      continue;
    }

    const e = new Error(data?.error?.message || "Gemini API error");
    e.status = aiRes.status;
    e.detail = data;
    throw e;
  }
}

async function generateChunk(chunk, mode, apiKey) {
  const body = {
    contents: [{ parts: [{ text: buildPrompt(chunk, mode) }] }],
    generationConfig: {
      temperature: mode === "quiz" || mode === "blank" ? 0.6 : 0.3,
      responseMimeType: "application/json",
      maxOutputTokens: 16384,
      // thinking 비활성화 → 응답 속도 향상 & 토큰 절약(잘림 방지)
      thinkingConfig: { thinkingBudget: 0 }
    }
  };

  const data = await callGeminiWithRetry(body, apiKey);

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const e = new Error("Empty Gemini response");
    e.status = 500;
    e.detail = data;
    throw e;
  }

  const cleanText = text
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleanText);
  } catch (parseError) {
    const e = new Error("Gemini returned broken JSON");
    e.status = 500;
    e.detail = cleanText;
    e.parseError = parseError.message;
    throw e;
  }

  return Array.isArray(parsed?.cards) ? parsed.cards : [];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { items, mode = "cards" } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No words provided" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is missing" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const limited = items.slice(0, MAX_WORDS);

    // 25개씩 나눠서 요청 (요청당 부하를 줄여 503/잘림 위험 감소)
    const chunks = [];
    for (let i = 0; i < limited.length; i += CHUNK_SIZE) {
      chunks.push(limited.slice(i, i + CHUNK_SIZE));
    }

    const allCards = [];
    for (const chunk of chunks) {
      const cards = await generateChunk(chunk, mode, apiKey);
      allCards.push(...cards);
    }

    return res.status(200).json({ cards: allCards });

  } catch (error) {
    const status = error.status || 500;
    const isBusy = status === 503 || status === 429;

    return res.status(status).json({
      error: isBusy
        ? "지금 AI가 많이 바빠요. 잠시 후 다시 눌러 주세요. 🙏"
        : (error.message || "AI generation failed"),
      detail: error.detail || error.message,
      ...(error.parseError ? { parseError: error.parseError } : {})
    });
  }
}
