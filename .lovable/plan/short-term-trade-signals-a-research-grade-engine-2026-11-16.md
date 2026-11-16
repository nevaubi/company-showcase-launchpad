# Short-term trade signals: a research-grade engine

Today's trade ideas use 7 simple rules (RSI pullback, 200-day breakdown, cheap/rich multiple, revenue accel/decel, insider buying), all judged on a single 3-month horizon with a plain hit rate. No trading costs, no out-of-sample test, and no correction for testing many rules. This plan replaces that with well-known, published strategies, each with strict proof. Each one runs on the full ~1,844-company universe and holds for 1–5 days or 1–4 weeks.

## 1. Strategies (from published research)

**Overreactions that snap back (1–5 days)**
- Short-term reversal: the worst losers over 1–5 days, measured against their sector, bounce back (Lehmann 1990; Jegadeesh 1990).
- Connors RSI(2) / IBS: oversold closes while the stock is still in an uptrend.
- Overnight-gap fade: big opening gaps with no news or filing behind them.
- Volume shock: big move on 3x normal volume and no 8-K filing. Moves with no news tend to reverse; moves backed by news tend to continue (Chan 2003).

**Momentum and breakouts (1–4 weeks)**
- 52-week-high proximity (George & Hwang 2004).
- Volatility-squeeze breakout: Bollinger width in its bottom decile, then a close outside the band.
- Time-series momentum scaled by volatility (Moskowitz, Ooi & Pedersen 2012).
- Post-earnings drift: a big earnings surprise plus a strong 3-day reaction keeps drifting (Bernard & Thomas 1989), using our sourced SEC figures and estimates.

**Pairs and correlations (1–4 weeks)**
- Cointegrated pairs within a sector: Engle-Granger test, z-score of the spread, entry at ±2, half-life filter of 5–30 days (Gatev, Goetzmann & Rouwenhorst 2006).
- Lead-lag: supplier and customer links from our supply-chain map. A customer's move predicts the supplier's next move (Cohen & Frazzini 2008).
- Sector residual reversal: a stock's return after removing market and sector moves, mean-reverting within a week (Avellaneda & Lee 2010).

**Context filters on every signal**
- Market regime: VIX level, SPY trend and realized volatility. A signal is shown only in regimes where it held up.
- Liquidity floor (dollar volume) and earnings-date blackout for non-earnings rules.

## 2. Strict proof (your choice)
A setup is shown only if all of these hold:
- Walk-forward testing: rules are fitted on past years and judged on later years they never saw.
- After trading costs: a spread and slippage estimate based on each stock's liquidity.
- Beats SPY and its sector ETF on average, with a t-stat above 2.
- Corrected for testing many rules: deflated Sharpe ratio (Bailey & López de Prado) and Benjamini-Hochberg false-discovery control.
- Enough history: at least 100 separate firings across the universe, overlapping holds removed.
- Stable: the result holds in both halves of the period and in at least two regimes.

## 3. What each setup card shows
Entry, stop (ATR-based) and target, holding period, and the out-of-sample hit rate, average return and worst drawdown. It also shows why the setup fired (the exact price stats, plus any filing, insider or supply-chain link with its source) and a small chart of past firings. Paper trades still work with one click.

## 4. Trades page
- One clean list ranked by strength (confidence × expected edge after costs), with simple filters: setup type, holding period, long or short, sector.
- A "Proof" page per strategy: equity curve, results by year and by regime, decay since publication.
- Pairs view: a spread chart with ±2 bands, plus a correlation heatmap of the sector.

## 5. Look and navigation (after the signals)
A follow-up plan covers simpler menus, alignment and polish, so this one stays focused.

## Technical details
- Pure modules: `src/lib/signals/stats.ts` (returns, z-scores, OLS, ADF/Engle-Granger, half-life, t-stat, deflated Sharpe, BH-FDR), `src/lib/signals/strategies/*.ts` (one file per strategy, point-in-time only), `src/lib/signals/backtest.ts` (walk-forward, non-overlapping samples, cost model, regime tags).
- `scripts/signals.ts` rebuilt to scan all 1,844 price files via `scripts/lib/datasets.ts`, writing `signals.json` (live setups) plus `signals-proof.json` (per-strategy stats). The scan is batched so it stays fast. 8-K dates, insider data and supply links come from existing tables.
- Daily refresh through the existing prices job slot after the close, with no AI spend.
- Tests: no look-ahead (a firing never uses later bars), cost math, stat functions against known values, and the gate rejecting a rule that is just noise.
- Keep existing `paper_trades` and the current idea format readable during the switch.
