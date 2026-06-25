export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No words provided" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is missing" });
    }

    const wordLines = items
      .slice(0, 20)
      .map(item => {
        return `Vocab Word: ${item.word}, Synonym: ${item.synonym || "create one"}, Antonym: ${item.antonym || "create one"}`;
      })
      .join("\n");

    const prompt = `
You are an English tutor for upper elementary to middle school students.

Return JSON only. No markdown. No explanation.

Input rule:
Each line has:
Vocab Word, optional Synonym, optional Antonym.

For each vocab word, create:
- word
- definition
- example1
- example2
- synonym
- antonym
- quizSentence
- distractors

Important rules:
- If a synonym is provided, use it exactly.
- If an antonym is provided, use it exactly.
- If synonym or antonym is missing, create a simple common one.
- definition: very easy English
- example1 and example2: simple student-friendly sentences
- quizSentence: 8 to 15 words and includes the target word
- distractors: 2 words with clearly different meanings
- no Korean

JSON format:
{
  "cards": [
    {
      "word": "visualize",
      "definition": "To make a picture in your mind.",
      "example1": "I visualize my dream house.",
      "example2": "She can visualize the story while reading.",
      "synonym": "envision",
      "antonym": "ignore",
      "quizSentence": "I can visualize my future school in my mind.",
      "distractors": ["break", "hide"]
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
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.5,
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

    const parsed = JSON.parse(text);

    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({
      error: "AI generation failed",
      detail: error.message
    });
  }
}
