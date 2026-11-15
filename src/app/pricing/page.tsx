import MarketingPage, { marketingMetadata, type MarketingContent } from "@/components/MarketingPage";
const content: MarketingContent = {
  "title": "Deriv Bot Pricing & Access",
  "description": "Information about Deriv Bot access and commercial availability. Contact the product team for current plans and onboarding details.",
  "intro": "Commercial availability, supported regions and service terms should be confirmed with the Deriv Bot product team before purchase.",
  "sections": [
    {
      "heading": "Plan information",
      "body": "Contact the product team for current pricing, supported account configurations, onboarding requirements and any applicable service limits. Do not rely on unofficial third-party pricing listings."
    },
    {
      "heading": "What to evaluate",
      "body": "Before choosing a plan, review supported markets, account connection requirements, security controls, support arrangements and whether demo testing is available."
    },
    {
      "heading": "No performance promises",
      "body": "Subscription or software access does not guarantee trading profits. Trading outcomes depend on market conditions, execution, strategy design and risk exposure."
    }
  ]
};
export const metadata = marketingMetadata(content, "/pricing");
export default function Page() { return <MarketingPage content={content} path="/pricing"/>; }
