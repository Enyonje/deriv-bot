import MarketingPage, { marketingMetadata, type MarketingContent } from "@/components/MarketingPage";
const content: MarketingContent = {
  "title": "Terms of Use",
  "description": "Terms for using Deriv Bot software, including eligibility, account security, acceptable use and trading risk.",
  "intro": "These draft terms describe basic software-use expectations. They must be reviewed by qualified counsel and adapted to the product owner’s jurisdiction, commercial model and actual service commitments before publication.",
  "sections": [
    {
      "heading": "Software service",
      "body": "Deriv Bot provides software tools for market analysis, strategy evaluation, trading automation and monitoring. Access may be modified or suspended for maintenance, security or compliance reasons."
    },
    {
      "heading": "User responsibility",
      "body": "You are responsible for understanding the financial products you trade, protecting your account credentials, selecting risk settings and complying with laws and Deriv account terms applicable to you."
    },
    {
      "heading": "Trading risk",
      "body": "Trading derivatives involves substantial risk. Software signals, automated execution, historical statistics and AI-generated analysis do not guarantee outcomes and are not financial advice. You may lose money."
    },
    {
      "heading": "No affiliation claim",
      "body": "Deriv Bot is an independent software product. It must not be represented as owned by, endorsed by or affiliated with Deriv unless a formal authorization or relationship exists."
    },
    {
      "heading": "Review before launch",
      "body": "These draft terms are not a substitute for legal advice. The product owner must finalize governing law, liability limitations, subscription terms, cancellation, dispute handling and contact details before accepting customers."
    }
  ]
};
export const metadata = marketingMetadata(content, "/terms");
export default function Page() { return <MarketingPage content={content} path="/terms"/>; }
