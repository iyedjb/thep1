import { Groq } from "groq-sdk";
import { logger } from "./logger";

let _groq: Groq | null = null;

export function getGroq(): Groq | null {
    if (_groq) return _groq;
    const apiKey = process.env["GROQ_API_KEY"];
    if (!apiKey) {
        logger.warn("GROQ_API_KEY not set — AI features will use fallback responses");
        return null;
    }
    _groq = new Groq({ apiKey });
    return _groq;
}

/**
 * Call Groq chat completions API with the given prompt using model "openai/gpt-oss-20b"
 */
export async function getGroqChatCompletion(prompt: string, temperature: number = 1): Promise<string> {
    const groq = getGroq();
    if (!groq) {
        throw new Error("GROQ_API_KEY is not configured");
    }

    const completion = await groq.chat.completions.create({
        messages: [
            {
                role: "user",
                content: prompt
            }
        ],
        model: "openai/gpt-oss-20b",
        temperature,
        max_completion_tokens: 9240,
        top_p: 1,
        stream: false,
        reasoning_effort: "medium",
        stop: null
    });

    return completion.choices[0]?.message?.content || "";
}
