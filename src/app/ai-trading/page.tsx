import MarketingPage, { marketingMetadata, type MarketingContent } from "@/components/MarketingPage";
const content: MarketingContent = {
  "title": "AI Trading Tools for Deriv | Deriv Bot Market Intelligence",
  "description": "Understand Deriv Bot market intelligence and agent-assisted trading workflows, with explainable signals and independent risk checks.",
  "intro": "Deriv Bot uses a modular agent workflow to analyse observations, evaluate strategy signals and check trade proposals against configured risk policies.",
  "sections": [
    {
      "heading": "Market intelligence agent",
      "body": "Summarizes price history into trend, momentum, volatility and market-regime observations. Analysis quality depends on the available data and market conditions."
    },
    {
      "heading": "Strategy agent",
      "body": "Evaluates deterministic strategy rules and returns a ranked set of candidate signals with a rationale. A signal is not a guarantee or a prediction of profit."
    },
    {
      "heading": "Decision and risk agents",
      "body": "The decision layer assembles a trade proposal. An independent risk layer checks stake, loss limits, trade quotas, confidence thresholds and account permissions before any execution controller can proceed."
    },
    {
      "heading": "Human oversight",
      "body": "Use demo accounts to validate behaviour. Keep the ability to pause automation and stop trading available at all times. Live trading should require explicit authorization and a separately validated deployment."
    }
  ]
};
export const metadata = marketingMetadata(content, "/ai-trading");
export default function Page() { return <MarketingPage content={content} path="/ai-trading"/>; }
