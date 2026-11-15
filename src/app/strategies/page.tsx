import MarketingPage, { marketingMetadata, type MarketingContent } from "@/components/MarketingPage";
const content: MarketingContent = {
  "title": "Deriv Trading Strategies | Technical Strategy Tools",
  "description": "Learn about trend, RSI mean-reversion, Bollinger and breakout strategy approaches supported by Deriv Bot.",
  "intro": "Deriv Bot provides a framework for evaluating rule-based strategies. Each approach has strengths, failure modes and market conditions where it may perform poorly.",
  "sections": [
    {
      "heading": "Trend and momentum",
      "body": "Moving-average alignment and momentum can help describe directional conditions. Signals may lag and can produce repeated false entries in sideways markets."
    },
    {
      "heading": "RSI mean reversion",
      "body": "Relative Strength Index readings can identify unusually strong recent moves. Overbought and oversold readings alone are not entry instructions; confirmation and risk limits remain important."
    },
    {
      "heading": "Bollinger reversion",
      "body": "Bollinger-style bands describe price dispersion around a moving average. Band touches can persist during trends, so regime filters and confirmation are necessary."
    },
    {
      "heading": "Breakout confirmation",
      "body": "Breakout rules look for price movement beyond a recent range with momentum confirmation. False breakouts and sudden volatility remain material risks."
    },
    {
      "heading": "Evaluate before deployment",
      "body": "Backtest with realistic assumptions, reserve out-of-sample data, paper trade and measure drawdown, profit factor and confidence intervals. Historical results do not establish future profitability."
    }
  ]
};
export const metadata = marketingMetadata(content, "/strategies");
export default function Page() { return <MarketingPage content={content} path="/strategies"/>; }
