export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmProvider {
  complete(messages: LlmMessage[], opts?: { model?: string; temperature?: number }): Promise<string>;
}

export class OpenAiProvider implements LlmProvider {
  constructor(
    private apiKey: string,
    private defaultModel = "gpt-4.1-mini",
  ) {}

  async complete(
    messages: LlmMessage[],
    opts?: { model?: string; temperature?: number },
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts?.model ?? this.defaultModel,
        temperature: opts?.temperature ?? 0.2,
        messages,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${text}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? "";
  }
}

export function createProvider(env: {
  OPENAI_API_KEY?: string;
  LLM_MODEL?: string;
}): LlmProvider {
  return new OpenAiProvider(env.OPENAI_API_KEY ?? "", env.LLM_MODEL);
}
