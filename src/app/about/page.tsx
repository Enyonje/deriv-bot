import MarketingPage, { marketingMetadata, type MarketingContent } from "@/components/MarketingPage";
const content: MarketingContent = {
  "title": "About Deriv Bot | Automated Trading Software",
  "description": "Learn about Deriv Bot, an independent trading software project focused on market analysis, systematic strategies and risk-aware execution.",
  "intro": "Deriv Bot is an independent software product designed to organize market analysis, strategy evaluation and trading workflows for users connecting eligible Deriv accounts.",
  "sections": [
    {
      "heading": "Product approach",
      "body": "We prioritize clear signals, explainable strategy rules, visible account status and independent risk checks."
    },
    {
      "heading": "Independent software",
      "body": "Deriv Bot is not the Deriv exchange and should not be represented as endorsed by or affiliated with Deriv unless a formal relationship exists."
    },
    {
      "heading": "Responsible use",
      "body": "Automated trading can lose money. Users should understand the contracts they trade, test on demo accounts and use only funds they can afford to lose."
    }
  ]
};
export const metadata = marketingMetadata(content, "/about");
export default function Page() { return <MarketingPage content={content} path="/about"/>; }
