import MarketingPage, { marketingMetadata, type MarketingContent } from "@/components/MarketingPage";
const content: MarketingContent = {
  "title": "Privacy Policy",
  "description": "Learn how Deriv Bot handles account credentials, session information and product usage data.",
  "intro": "This page describes the intended privacy practices for the Deriv Bot application. The product owner should review and adapt this policy to the actual hosting, analytics and support providers before public launch.",
  "sections": [
    {
      "heading": "Deriv account credentials",
      "body": "The application stores Deriv connection credentials in an encrypted, HTTP-only session cookie. Credentials are not returned in the public account profile response. Operators must protect the session encryption secret and hosting environment."
    },
    {
      "heading": "Technical data",
      "body": "The hosting environment may process standard technical information such as request metadata, error logs and security events. Configure log retention and access controls to avoid collecting unnecessary personal information or secrets."
    },
    {
      "heading": "Analytics and cookies",
      "body": "No third-party analytics provider is assumed by this codebase. If analytics, advertising pixels or additional cookies are added, disclose the provider, purpose, consent basis and retention period here before enabling them."
    },
    {
      "heading": "Data requests",
      "body": "Users should contact the product operator through the published support channel for account disconnection, data questions or privacy requests. The operator must define retention and deletion procedures for any records held outside the browser session."
    }
  ]
};
export const metadata = marketingMetadata(content, "/privacy");
export default function Page() { return <MarketingPage content={content} path="/privacy"/>; }
