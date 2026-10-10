// fetchQuestions.js
const fs = require('fs');
const path = require('path');
const { Groq } = require('groq-sdk');

// Initialize Groq (Get a free key from https://console.groq.com/)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function getCricketQuestions(count = 5) {
    let collectedQuestions = [];

    try {
        const prompt = `Generate exactly ${count} unique cricket trivia questions. Every single question MUST be strictly about the sport of cricket (international matches, IPL, ICC World Cups, legendary cricketers, rules, or historical records). Do not include any other sport.
        Return ONLY a valid JSON array of objects with this exact structure, with no markdown formatting outside the array:
        [
          {
            "question": "Question text here?",
            "correct_answer": "Correct answer string",
            "incorrect_answers": ["Wrong 1", "Wrong 2", "Wrong 3"]
          }
        ]`;

        const response = await groq.chat.completions.create({
            model: "openai/gpt-oss-20b", // Fast, smart, and completely free on Groq's tier
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
        });

        let rawContent = response.choices[0].message.content.trim();
        rawContent = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const aiQuestions = JSON.parse(rawContent);
        if (Array.isArray(aiQuestions) && aiQuestions.length > 0) {
            collectedQuestions.push(...aiQuestions);
        }
    } catch (error) {
        console.warn("Groq AI generation failed, using local cricket database:", error.message);
    }

    // Fallback to local JSON database if needed
    if (collectedQuestions.length < count) {
        try {
            const filePath = path.join(__dirname, 'cricket_questions.json');
            if (fs.existsSync(filePath)) {
                const rawData = fs.readFileSync(filePath, 'utf8');
                const localDb = JSON.parse(rawData);
                const shuffledLocal = [...localDb].sort(() => 0.5 - Math.random());
                const needed = count - collectedQuestions.length;
                collectedQuestions.push(...shuffledLocal.slice(0, needed));
            }
        } catch (localError) {
            console.error("Local database fallback failed:", localError.message);
        }
    }

    // Absolute final safety net
    if (collectedQuestions.length === 0) {
        collectedQuestions.push({
            question: "Who won the ICC Men's T20 World Cup in 2024?",
            correct_answer: "India",
            incorrect_answers: ["Australia", "England", "South Africa"]
        });
    }

    const finalSelection = [...collectedQuestions].sort(() => 0.5 - Math.random()).slice(0, count);

    return finalSelection.map(item => {
        const options = [...item.incorrect_answers];
        const randomIndex = Math.floor(Math.random() * (options.length + 1));
        options.splice(randomIndex, 0, item.correct_answer);

        return {
            question: item.question,
            options: options,
            answer: randomIndex
        };
    });
}

module.exports = { getCricketQuestions };