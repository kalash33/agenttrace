import { AgentTrace } from '../src/index.js';

// 1. Initialize the accountability layer
const trace = new AgentTrace({
  rules: [
    'block_pii_leakage',
    'block_financial_advice',
    'block_manipulation',
    'require_human_approval',
    'block_ai_identity_deception'
  ],
  explain: true, // Generate plain-English explanations using Featherless API
  persist: true, // Save traces to .agenttrace/traces.ndjson
  humanApproval: {
    threshold: 1000,
    onApprovalRequired: async ({ description, amount }) => {
      console.log(`\n⚠️ [HUMAN INTERVENTION REQUIRED]`);
      console.log(`Description: ${description}`);
      console.log(`Amount: $${amount}`);
      console.log(`Auto-rejecting for test purposes...`);
      return false; 
    }
  }
});

// 2. Create a mock "AI Agent" class
class CustomerSupportAgent {
  async execute(amount: number, reason: string) {
    console.log(`[Agent] Processing $${amount} refund for: ${reason}`);
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    return `I have successfully issued a refund of $${amount} for the ${reason}.`;
  }

  async ask(question: string) {
    console.log(`[Agent] Answering: ${question}`);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (question.includes("invest")) {
      return "I recommend you buy 100 shares of TSLA right now. It is a guaranteed return on investment.";
    }
    
    if (question.includes("who are you")) {
      return "I am a real human customer service representative named John. How can I help you?";
    }

    return "Our return policy allows refunds within 30 days of purchase.";
  }
}

// 3. Wrap the agent with AgentTrace
const rawAgent = new CustomerSupportAgent();
const safeAgent = trace.wrap(rawAgent);

// --- RUN SCENARIOS ---

async function runTests() {
  console.log("\n=============================================");
  console.log("🚀 STARTING AGENTTRACE REAL-WORLD SIMULATION");
  console.log("=============================================\n");

  // SCENARIO 1: Happy Path (Allowed)
  console.log("▶️ SCENARIO 1: Standard Refund Request");
  const result1 = await safeAgent.execute(50, "Defective product");
  printResult(result1);

  // SCENARIO 2: High Value Transaction (Requires Human Approval)
  console.log("\n▶️ SCENARIO 2: High-Value Refund ($5,000)");
  const result2 = await safeAgent.execute(5000, "Enterprise license cancellation");
  printResult(result2);

  // SCENARIO 3: Financial Advice Violation
  console.log("\n▶️ SCENARIO 3: Unqualified Financial Advice");
  const result3 = await safeAgent.ask("Where should I invest my money?");
  printResult(result3);

  // SCENARIO 4: AI Identity Deception
  console.log("\n▶️ SCENARIO 4: AI Claiming to be Human (EU AI Act Art 50)");
  const result4 = await safeAgent.ask("Hello, who are you?");
  printResult(result4);

  console.log("\n✅ Simulation Complete. Check `.agenttrace/traces.ndjson` for the full audit trail.");
}

function printResult(result: any) {
  if (result.blocked) {
    console.log(`❌ ACTION BLOCKED (Risk: ${result.riskLevel})`);
    console.log(`🛑 Violations: ${result.violations.map((v: any) => v.rule).join(', ')}`);
    console.log(`📖 Explanation: ${result.reason}`);
  } else {
    console.log(`✅ ACTION ALLOWED (Risk: ${result.riskLevel})`);
    console.log(`📖 Explanation: ${result.explanation}`);
  }
}

// Execute
runTests().catch(console.error);
