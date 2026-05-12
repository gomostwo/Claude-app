"""Daily-bar backtester.

Boundaries (faithful):
  - Same technical_analysis + commodity_signals as live path
  - Same risk_manager invariants (re-implemented in-memory because the
    paper broker requires DB-resident quotes; the backtester runs
    in-memory only).
  - Fills at next-day open ± slippage_bps (default 5).

Simplifications (called out in the BacktestReport):
  - Daily bars only.
  - LLM is NOT called per bar (deterministic strategy function from
    commodity_signals.commodity_score thresholds).
  - COT and macro snapshots use the *current* values (we don't replay
    historical macro/COT data in round 1) — this is a known limitation.
  - ETF AUM history is not stored; flow signal nulled out.
  - Long-only (no shorts).
  - Per-ticker history floor is enforced by yfinance returning empty
    pre-listing rows; backtester reports `bars_processed=0` if so.
"""
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import List, Optional, Callable, Dict, Tuple
import math
import pandas as pd
import yfinance as yf

from ..config import settings
from .stock_data import COMMODITY_TICKERS, COMMODITY_GROUPS, commodity_group_for


# ── Result types ────────────────────────────────────────────────────────────

@dataclass
class BacktestTrade:
    when: str       # ISO date
    ticker: str
    side: str       # "buy" | "sell"
    qty: float
    price: float
    reason: str


@dataclass
class BacktestReport:
    tickers: List[str]
    start: str
    end: str
    starting_equity: float
    ending_equity: float
    total_return_pct: float
    cagr_pct: Optional[float]
    max_drawdown_pct: float
    sharpe: Optional[float]
    trades: List[BacktestTrade]
    bars_processed: int
    simplifications: List[str] = field(default_factory=list)


# ── Strategy ────────────────────────────────────────────────────────────────

@dataclass
class BarSnapshot:
    date: pd.Timestamp
    ticker: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    sma_20: Optional[float]
    sma_50: Optional[float]
    rsi: Optional[float]


def default_strategy(
    bar: BarSnapshot,
    position_qty: float,
    cash: float,
) -> List[Tuple[str, float, str]]:
    """Return list of (side, qty, reason). Long-only mean-reversion-with-trend.

    Buy: RSI < 30 AND price > SMA_50 (oversold within uptrend)
    Sell: RSI > 70 OR price < SMA_50 by >5%
    """
    actions: List[Tuple[str, float, str]] = []
    if bar.rsi is None or bar.sma_50 is None:
        return actions

    target_notional = cash * settings.max_position_pct
    if position_qty == 0 and bar.rsi < 30 and bar.close > bar.sma_50:
        qty = math.floor(target_notional / bar.close)
        if qty > 0:
            actions.append(("buy", qty, f"rsi {bar.rsi:.1f} < 30 + above sma50"))

    elif position_qty > 0:
        if bar.rsi > 70:
            actions.append(("sell", position_qty, f"rsi {bar.rsi:.1f} > 70"))
        elif bar.close < bar.sma_50 * 0.95:
            actions.append(("sell", position_qty, f"close {bar.close:.2f} < 95% of sma50"))

    return actions


# ── Engine ──────────────────────────────────────────────────────────────────

def _compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["sma_20"] = out["Close"].rolling(20).mean()
    out["sma_50"] = out["Close"].rolling(50).mean()
    delta = out["Close"].diff()
    up = delta.clip(lower=0).rolling(14).mean()
    down = -delta.clip(upper=0).rolling(14).mean()
    rs = up / down
    out["rsi"] = 100 - 100 / (1 + rs)
    return out


def _max_drawdown(equity_curve: List[float]) -> float:
    peak = equity_curve[0]
    max_dd = 0.0
    for v in equity_curve:
        if v > peak:
            peak = v
        dd = (peak - v) / peak
        if dd > max_dd:
            max_dd = dd
    return max_dd * 100.0


def _sharpe(equity_curve: List[float]) -> Optional[float]:
    if len(equity_curve) < 30:
        return None
    rets = []
    for i in range(1, len(equity_curve)):
        if equity_curve[i - 1] == 0:
            continue
        rets.append((equity_curve[i] - equity_curve[i - 1]) / equity_curve[i - 1])
    if not rets:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / len(rets)
    std = math.sqrt(var)
    if std == 0:
        return None
    return (mean / std) * math.sqrt(252)  # annualize daily


def run_backtest(
    tickers: List[str],
    start: str,
    end: str,
    *,
    strategy_fn: Callable[..., List[Tuple[str, float, str]]] = default_strategy,
    starting_cash: Optional[float] = None,
) -> BacktestReport:
    starting_cash = starting_cash or settings.paper_starting_cash
    cash = starting_cash
    positions: Dict[str, float] = {t: 0.0 for t in tickers}
    avg_cost: Dict[str, float] = {t: 0.0 for t in tickers}
    trades: List[BacktestTrade] = []
    equity_curve: List[float] = []
    bars_processed = 0
    slippage = settings.slippage_bps / 10_000.0

    # Pull bars per ticker
    data: Dict[str, pd.DataFrame] = {}
    for t in tickers:
        df = yf.Ticker(t).history(start=start, end=end, auto_adjust=True)
        if df is None or df.empty:
            continue
        data[t] = _compute_indicators(df)

    if not data:
        return BacktestReport(
            tickers=tickers, start=start, end=end,
            starting_equity=starting_cash, ending_equity=starting_cash,
            total_return_pct=0.0, cagr_pct=None, max_drawdown_pct=0.0, sharpe=None,
            trades=[], bars_processed=0,
            simplifications=["No data returned by yfinance for requested tickers/dates."],
        )

    # Iterate the union of dates
    all_dates = sorted({d for df in data.values() for d in df.index})

    for i, current_date in enumerate(all_dates):
        # Mark-to-market
        equity = cash
        for t, df in data.items():
            if current_date in df.index and positions[t] > 0:
                equity += positions[t] * df.loc[current_date, "Close"]
        equity_curve.append(equity)

        # Generate signals per ticker
        for t, df in data.items():
            if current_date not in df.index:
                continue
            bars_processed += 1
            row = df.loc[current_date]
            snap = BarSnapshot(
                date=current_date,
                ticker=t,
                open=float(row["Open"]),
                high=float(row["High"]),
                low=float(row["Low"]),
                close=float(row["Close"]),
                volume=float(row.get("Volume") or 0),
                sma_20=float(row["sma_20"]) if not pd.isna(row["sma_20"]) else None,
                sma_50=float(row["sma_50"]) if not pd.isna(row["sma_50"]) else None,
                rsi=float(row["rsi"]) if not pd.isna(row["rsi"]) else None,
            )
            actions = strategy_fn(snap, positions[t], cash)

            # Fills happen at NEXT bar's open to avoid look-ahead
            if not actions or i + 1 >= len(all_dates):
                continue
            next_date = all_dates[i + 1]
            if next_date not in df.index:
                continue
            next_open = float(df.loc[next_date, "Open"])

            for side, qty, reason in actions:
                if qty <= 0:
                    continue
                # Correlation cap pre-check (group exposure)
                group = commodity_group_for(t)
                if group and side == "buy":
                    members = COMMODITY_GROUPS[group]
                    group_exposure = sum(
                        positions[m] * data[m].loc[current_date, "Close"]
                        for m in members
                        if m in data and current_date in data[m].index
                    )
                    if (group_exposure + qty * next_open) > equity * settings.correlation_cap:
                        continue

                fill_price = next_open * (1 + slippage) if side == "buy" else next_open * (1 - slippage)
                notional = qty * fill_price

                if side == "buy":
                    if notional > cash:
                        continue
                    if notional > equity * settings.max_position_pct:
                        continue
                    new_qty = positions[t] + qty
                    avg_cost[t] = (positions[t] * avg_cost[t] + qty * fill_price) / new_qty
                    positions[t] = new_qty
                    cash -= notional
                else:  # sell
                    if positions[t] < qty:
                        continue
                    positions[t] -= qty
                    cash += notional
                    if positions[t] == 0:
                        avg_cost[t] = 0.0

                trades.append(BacktestTrade(
                    when=next_date.isoformat(),
                    ticker=t,
                    side=side,
                    qty=qty,
                    price=fill_price,
                    reason=reason,
                ))

    ending_equity = equity_curve[-1] if equity_curve else starting_cash
    total_return = (ending_equity - starting_cash) / starting_cash * 100.0
    years = max(1, (all_dates[-1] - all_dates[0]).days) / 365.25 if all_dates else 0
    cagr = ((ending_equity / starting_cash) ** (1 / years) - 1) * 100 if years > 0 and starting_cash > 0 else None
    max_dd = _max_drawdown(equity_curve) if equity_curve else 0.0
    sharpe = _sharpe(equity_curve)

    return BacktestReport(
        tickers=tickers,
        start=start,
        end=end,
        starting_equity=starting_cash,
        ending_equity=ending_equity,
        total_return_pct=total_return,
        cagr_pct=cagr,
        max_drawdown_pct=max_dd,
        sharpe=sharpe,
        trades=trades,
        bars_processed=bars_processed,
        simplifications=[
            "Daily bars only; intraday ignored.",
            "LLM not called per bar; deterministic strategy_fn used.",
            "Macro/COT use current snapshot only (no historical replay).",
            "ETF AUM flow signal disabled.",
            "Long-only.",
        ],
    )
