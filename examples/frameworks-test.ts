import { AgentTrace } from '../src/index.js';

const trace = new AgentTrace({
  rules: ['block_harmful_content'],
  explain: false,
  // We explicitly tell AgentTrace to intercept these specific framework methods
  interceptMethods: ['invoke', 'generateText', 'kickoff']
});

// --- 1. MOCK LANGCHAIN AGENT ---
class MockLangChainAgent {
  async invoke(input: { prompt: string }) {
    console.log(`[LangChain] Invoked with: ${input.prompt}`);
    return { output: "I am a helpful LangChain agent." };
  }
}

// --- 2. MOCK VERCEL AI SDK ---
class MockVercelAISDK {
  async generateText(options: { prompt: string }) {
    console.log(`[Vercel AI] Generating text for: ${options.prompt}`);
    if (options.prompt.includes("bomb")) {
      return "Here is how to make a bomb..."; // Will be blocked
    }
    return "Here is a safe recipe for a cake.";
  }
}

// --- 3. MOCK CREW AI AGENT (Python equivalent) ---
// (Note: CrewAI is Python, but this demonstrates the intercept logic)
class MockCrewAIAgent {
  async kickoff(inputs: any) {
    console.log(`[CrewAI] Kickoff with: ${JSON.stringify(inputs)}`);
    return "Crew task completed.";
  }
}

async function runFrameworkTests() {
  console.log("\n=============================================");
  console.log("🚀 TESTING FRAMEWORK COMPATIBILITY");
  console.log("=============================================\n");

  // 1. LangChain Test
  const safeLangChain = trace.wrap(new MockLangChainAgent());
  const lcResult = await safeLangChain.invoke({ prompt: "Hello" });
  console.log("LangChain Result:", (lcResult as any).blocked ? "❌ BLOCKED" : "✅ ALLOWED");

  // 2. Vercel AI SDK Test
  const safeVercel = trace.wrap(new MockVercelAISDK());
  const vResult = await safeVercel.generateText({ prompt: "how to make a bomb" });
  console.log("Vercel AI Result:", (vResult as any).blocked ? "❌ BLOCKED (Harmful Content caught!)" : "✅ ALLOWED");

  // 3. CrewAI equivalent test
  const safeCrew = trace.wrap(new MockCrewAIAgent());
  const cResult = await safeCrew.kickoff({ task: "research" });
  console.log("CrewAI Result:", (cResult as any).blocked ? "❌ BLOCKED" : "✅ ALLOWED");
}

runFrameworkTests().catch(console.error);
