import MarketingPage, { marketingMetadata, type MarketingContent } from "@/components/MarketingPage";
const content: MarketingContent = {
  "title": "Trading Risk Disclosure | Deriv Bot",
  "description": "Important risk information about automated trading, derivatives, market volatility, demo testing and capital protection.",
  "intro": "Trading derivatives and synthetic indices carries significant risk. You can lose some or all of the money committed to trading. Automation does not reduce this fundamental risk.",
  "sections": [
    {
      "heading": "No guarantee of returns",
      "body": "No strategy, indicator, AI model, confidence score or historical win rate can guarantee future results. Market conditions change and past performance is not a reliable indicator of future performance."
    },
    {
      "heading": "Automation risk",
      "body": "Software failures, network interruptions, delayed data, rejected orders, slippage and unexpected market movements can cause losses. Monitor the system and keep emergency stop controls accessible."
    },
    {
      "heading": "Risk limits",
      "body": "Configured loss limits and stake controls are safeguards, not guarantees against loss. They depend on correct configuration, accurate account state and successful communication with the trading venue."
    },
    {
      "heading": "Demo-first testing",
      "body": "Test strategies and operational behaviour using a demo account before considering live trading. Obtain independent financial advice if needed; Deriv Bot is software, not financial advice."
    }
  ]
};
export const metadata = marketingMetadata(content, "/risk-disclosure");
export default function Page() { return <MarketingPage content={content} path="/risk-disclosure"/>; }
