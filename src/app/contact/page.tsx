import MarketingPage, { marketingMetadata, type MarketingContent } from "@/components/MarketingPage";
const content: MarketingContent = {
  "title": "Contact Deriv Bot | Product & Support Enquiries",
  "description": "Contact the Deriv Bot team for product information, onboarding, technical support and commercial enquiries.",
  "intro": "For product, onboarding, technical or commercial questions, contact the Deriv Bot team through the support channel provided by your product administrator.",
  "sections": [
    {
      "heading": "Technical support",
      "body": "When reporting an issue, include the time, affected feature, browser and a sanitized error message. Never send API tokens, passwords or full payment details."
    },
    {
      "heading": "Account security",
      "body": "Deriv account credentials and personal access tokens should only be entered through the application’s secure account-connection flow. Support staff should never ask you to disclose a token in plain text."
    },
    {
      "heading": "Business enquiries",
      "body": "For licensing, deployment and partnership enquiries, request current terms directly from the product owner."
    }
  ]
};
export const metadata = marketingMetadata(content, "/contact");
export default function Page() { return <MarketingPage content={content} path="/contact"/>; }
