export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { words } = req.body;

    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: "No words provided" });
    }

    const prompt = `
You are an English tutor for upper elementary to middle school students.

Return JSON only. No markdown. No explanation.

For each word, create:
- word
- definition
- example1
- example2
- synonym
- quizSentence
- distractors

Rules:
- definition: very easy English
- example1 and example2: simple student-friendly sentences
- synonym: one common synonym
- quizSentence: 8 to 15 words and includes the target word
- distractors: 3 words with clearly different meanings
- no Korean

JSON format:
{
  "cards": [
    {
      "word": "visualize",
      "definition": "To make a picture in your mind.",
      "example1": "I visualize my dream house.",
      "example2": "She can visualize the story while reading.",
      "synonym": "imagine",
      "quizSentence": "I can visualize my future school in my mind.",
      "distractors": ["forget", "break", "hide"]
    }
  ]
}

Words:
${words.slice(0, 20).join(", ")}
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
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.7,
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

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    const parsed = JSON.parse(text);

    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({
      error: "AI generation failed",
      detail: error.message
    });
  }
}
