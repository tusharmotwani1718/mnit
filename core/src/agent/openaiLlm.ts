import OpenAI from "openai";
import type { FactDef } from "../engine/index.js";
import { buildOutputSchema, buildUserMessage, SYSTEM_PROMPT, type LlmTurnInput, type LlmTurnOutput, type TurnLlm } from "./llm.js";

export class OpenAiTurnLlm implements TurnLlm {
  private client: OpenAI;
  private schema: Record<string, unknown>;

  constructor(
    defs: Record<string, FactDef>,
    schemeIds: string[],
    private model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    apiKey = process.env.OPENAI_API_KEY,
  ) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    this.client = new OpenAI({ apiKey });
    this.schema = buildOutputSchema(defs, schemeIds);
  }

  async turn(input: LlmTurnInput): Promise<LlmTurnOutput> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: "json_schema", json_schema: { name: "turn", strict: true, schema: this.schema } },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(input) },
      ],
    });
    const content = res.choices[0]?.message.content;
    if (!content) throw new Error(`Empty LLM response (finish_reason: ${res.choices[0]?.finish_reason})`);
    return JSON.parse(content) as LlmTurnOutput;
  }
}
