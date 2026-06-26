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

    const wordLines = items
      .slice(0, 20)
      .map(item =>
        `${item.word}|${item.synonym || ""}|${item.antonym || ""}|${item.partOfSpeech || ""}`
      )
      .join("\n");

    const prompt = `
Return JSON only.

Make English vocab cards for students.

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

    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: mode === "quiz" || mode === "blank" ? 0.6 : 0.3,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await aiRes.json();

    if (!aiRes.ok) {
      return res.status(500).json({
        error: "Gemini API error",
        detail: data
      });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(500).json({
        error: "Empty Gemini response",
        detail: data
      });
    }

    let cleanText = text
      .trim()
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim();
    
    try {
      const parsed = JSON.parse(cleanText);
      return res.status(200).json(parsed);
    } catch (parseError) {
      return res.status(500).json({
        error: "Gemini returned broken JSON",
        detail: cleanText,
        parseError: parseError.message
      });
    }

  } catch (error) {
    return res.status(500).json({
      error: "AI generation failed",
      detail: error.message
    });
  }
}
