// Ambient stub for 'openai' — used only during DTS generation.
// The real module is loaded dynamically at runtime.
declare module 'openai' {
  interface ChatCompletion {
    choices: Array<{
      message: { content: string | null } | null;
    }>;
  }

  interface ChatCompletionCreateParamsNonStreaming {
    model: string;
    max_tokens?: number;
    temperature?: number;
    messages: Array<{ role: string; content: string }>;
  }

  interface Chat {
    completions: {
      create(params: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion>;
    };
  }

  class OpenAI {
    constructor(opts: { apiKey?: string; baseURL?: string; timeout?: number; maxRetries?: number });
    chat: Chat;
  }

  export default OpenAI;
}
