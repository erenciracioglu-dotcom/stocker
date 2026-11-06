#!/usr/bin/env python3
"""Stocker veri toplayıcı.

Yahoo Finance verisini (yfinance ile) çekip uygulamanın okuduğu statik JSON dosyalarına yazar:

  market.json           tüm semboller için son fiyat, günlük değişim, kurlar, 6 aylık kapanış serisi
  history/<SYM>.json    günlük OHLCV (10 yıla kadar)
  intraday/<SYM>.json   son 5 günün 15 dakikalık mumları (seans öncesi/sonrası dahil)
  fund/<SYM>.json       profil, oranlar, mali tablolar, analist hedefleri, takvim, haberler

Semboller tickers.json'dan okunur. Her çalıştırmada portföy ve endeks fiyatları tazelenir,
izleme listesi üç saatte bir; uzun geçmiş haftada bir baştan indirilir; temel veriler
portföy için günde bir, izleme listesi için üç günde bir yenilenir.

Kullanım:
  python scripts/fetch_data.py --out _data
  python scripts/fetch_data.py --out _data --only PYPD,GARAN.IS --fund-limit 2
  python scripts/fetch_data.py --out _data --full        # her şeyi baştan çek
"""
from __future__ import annotations

import argparse
import json
import math
import random
import re
import sys
import time
import traceback
import datetime as dt
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
UTC = dt.timezone.utc
SPARK_DAYS = 130            # market.json içindeki kapanış serisi (~6 ay)
FULL_EVERY = dt.timedelta(days=7)
WATCH_EVERY = dt.timedelta(hours=3)
FUND_EVERY = {"P": dt.timedelta(hours=20), "B": dt.timedelta(hours=20), "W": dt.timedelta(hours=70)}


# ---------------------------------------------------------------- yardımcılar

def now() -> dt.datetime:
    return dt.datetime.now(UTC)


def iso(t: dt.datetime) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s):
    try:
        return dt.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except Exception:
        return None


def safe_name(sym: str) -> str:
    """Dosya adı: ^GSPC -> _GSPC, USDTRY=X -> USDTRY_X (uygulamadaki fileName ile aynı)."""
    return re.sub(r"[^A-Za-z0-9.\-]", "_", sym)


def num(x, nd=None):
    try:
        if x is None or isinstance(x, str):
            return None
        if isinstance(x, bool):
            return None
        f = float(x)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, nd) if nd is not None else f
    except Exception:
        return None


def pr(x):
    """Fiyatı büyüklüğüne göre yuvarlar (JSON'u küçük tutar)."""
    f = num(x)
    if f is None:
        return None
    a = abs(f)
    return round(f, 2 if a >= 10 else 4 if a >= 1 else 6)


def clean(o):
    """JSON'a girmeden önce NaN/numpy/tarih temizliği."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, float):
        return None if (math.isnan(o) or math.isinf(o)) else o
    if isinstance(o, (pd.Timestamp, dt.datetime)):
        try:
            return o.strftime("%Y-%m-%d") if (o.hour, o.minute, o.second) == (0, 0, 0) else o.isoformat()
        except Exception:
            return str(o)
    if isinstance(o, dt.date):
        return o.isoformat()
    if hasattr(o, "item") and not isinstance(o, (str, bytes)):
        try:
            return clean(o.item())
        except Exception:
            return str(o)
    return o


def load_json(p, default=None):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(p, obj):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(clean(obj), ensure_ascii=False, separators=(",", ":"), allow_nan=False),
                   encoding="utf-8")
    tmp.replace(p)


def retry(fn, tries=3, what=""):
    last = None
    for i in range(tries):
        try:
            return fn()
        except Exception as e:  # yfinance bazen oran sınırı ya da geçici ağ hatası verir
            last = e
            msg = f"{type(e).__name__}: {e}"
            rate = "RateLimit" in msg or "Too Many" in msg or "429" in msg
            if i < tries - 1:
                time.sleep((8 if rate else 1.5) * (i + 1) + random.random())
    raise last


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- sembol listesi

def load_universe(path: Path):
    cfg = load_json(path, {}) or {}

    def norm(lst):
        out = []
        for s in lst or []:
            s = str(s).strip().upper()
            if s and s not in out:
                out.append(s)
        return out

    groups = {}
    for g, key in (("P", "portfolio"), ("B", "benchmarks"), ("W", "watch")):
        for s in norm(cfg.get(key)):
            groups.setdefault(s, g)  # ilk görülen grup kazanır (P > B > W)
    return groups, norm(cfg.get("benchmarks"))


def special(sym: str):
    if sym.startswith("^"):
        return "INDEX"
    if sym.endswith("=X"):
        return "CURRENCY"
    if sym.endswith("=F"):
        return "FUTURE"
    return None


# ---------------------------------------------------------------- fiyat geçmişi

def df_daily(df: pd.DataFrame):
    if df is None or df.empty:
        return None
    df = df.dropna(subset=["Close"])
    if df.empty:
        return None
    vol = df["Volume"] if "Volume" in df else [0] * len(df)
    return {
        "t": [d.strftime("%Y-%m-%d") for d in df.index],
        "o": [pr(x) for x in df["Open"]],
        "h": [pr(x) for x in df["High"]],
        "l": [pr(x) for x in df["Low"]],
        "c": [pr(x) for x in df["Close"]],
        "v": [int(num(x) or 0) for x in vol],
    }


def merge_daily(old, new):
    rows = {}
    for src in (old, new):
        if not src:
            continue
        for i, d in enumerate(src["t"]):
            rows[d] = (src["o"][i], src["h"][i], src["l"][i], src["c"][i], src["v"][i])
    keys = sorted(rows)
    return {
        "t": keys,
        "o": [rows[k][0] for k in keys],
        "h": [rows[k][1] for k in keys],
        "l": [rows[k][2] for k in keys],
        "c": [rows[k][3] for k in keys],
        "v": [rows[k][4] for k in keys],
    }


def split_suspect(old, new) -> bool:
    """Bölünme/düzeltme sonrası eski kapanışlar değişmişse tam yenileme gerekir."""
    if not old or not new:
        return False
    oc = dict(zip(old["t"], old["c"]))
    ratios = []
    for d, c in list(zip(new["t"], new["c"]))[:-3]:
        if d in oc and oc[d] and c:
            ratios.append(c / oc[d])
    if not ratios:
        return False
    ratios.sort()
    med = ratios[len(ratios) // 2]
    return abs(med - 1) > 0.03


def to_epoch(x):
    """yfinance 1.x zamanları pandas Timestamp olarak verir; eski sürümler epoch saniye."""
    if x is None or isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return int(x)
    try:
        return int(pd.Timestamp(x).timestamp())
    except Exception:
        return None


def pick_meta(md: dict) -> dict:
    if not md:
        return {}
    ctp = md.get("currentTradingPeriod") or {}

    def per(k):
        p = ctp.get(k) or {}
        if isinstance(p, dict):
            s, e = to_epoch(p.get("start")), to_epoch(p.get("end"))
            if s and e:
                return [s, e]
        return None

    out = {
        "cur": md.get("currency"),
        "ex": md.get("fullExchangeName") or md.get("exchangeName"),
        "n": md.get("longName") or md.get("shortName"),
        "ty": md.get("instrumentType"),
        "tz": md.get("exchangeTimezoneName"),
        "rmp": pr(md.get("regularMarketPrice")),
        "rmt": to_epoch(md.get("regularMarketTime")),
        "pcl": pr(md.get("previousClose")),
        "h52": pr(md.get("fiftyTwoWeekHigh")),
        "l52": pr(md.get("fiftyTwoWeekLow")),
        "pre": per("pre"),
        "reg": per("regular"),
        "post": per("post"),
    }
    return {k: v for k, v in out.items() if v is not None}


def fetch_daily(sym, group, out: Path, full_all: bool, stats: dict):
    path = out / "history" / f"{safe_name(sym)}.json"
    old = load_json(path)
    t0 = now()
    if old and group == "W" and not full_all:
        upd = parse_iso(old.get("upd", ""))
        if upd and t0 - upd < WATCH_EVERY:
            return old, False  # izleme listesi: yeterince taze
    need_full = full_all or not old or not old.get("t")
    if not need_full:
        fa = parse_iso(old.get("full", ""))
        need_full = not fa or t0 - fa > FULL_EVERY
    tk = yf.Ticker(sym)

    def get(period):
        df = tk.history(period=period, interval="1d", auto_adjust=False, actions=False)
        return df_daily(df), pick_meta(tk.get_history_metadata() or {})

    if need_full:
        data, meta = retry(lambda: get("10y"))
        stats["full"] += 1
    else:
        data, meta = retry(lambda: get("1mo"))
        if data and split_suspect(old, data):
            data, meta = retry(lambda: get("10y"))
            need_full = True
            stats["full"] += 1
        else:
            data = merge_daily(old, data) if data else None
    if not data or not data["t"]:
        if old and old.get("t"):
            return old, False
        raise RuntimeError("fiyat verisi yok")
    rec = {
        "s": sym,
        "full": iso(t0) if need_full else old.get("full"),
        "upd": iso(t0),
        "m": meta or (old or {}).get("m", {}),
        **data,
    }
    save_json(path, rec)
    return rec, True


def fetch_intraday(sym, out: Path):
    tk = yf.Ticker(sym)
    df = retry(lambda: tk.history(period="5d", interval="15m", prepost=True, auto_adjust=False, actions=False))
    if df is None or df.empty:
        return None
    df = df.dropna(subset=["Close"])
    meta = pick_meta(tk.get_history_metadata() or {})
    rec = {
        "s": sym,
        "upd": iso(now()),
        "m": meta,
        "t": [int(ts.timestamp()) for ts in df.index],
        "o": [pr(x) for x in df["Open"]],
        "h": [pr(x) for x in df["High"]],
        "l": [pr(x) for x in df["Low"]],
        "c": [pr(x) for x in df["Close"]],
        "v": [int(num(x) or 0) for x in df["Volume"]],
    }
    save_json(out / "intraday" / f"{safe_name(sym)}.json", rec)
    return rec


# ---------------------------------------------------------------- anlık görünüm

def local_date(epoch, tz):
    try:
        return pd.Timestamp(int(epoch), unit="s", tz="UTC").tz_convert(tz or "UTC").strftime("%Y-%m-%d")
    except Exception:
        return None


def tod_minutes(epoch, tz):
    ts = pd.Timestamp(int(epoch), unit="s", tz="UTC").tz_convert(tz or "UTC")
    return ts.hour * 60 + ts.minute


def build_quote(sym, group, hist, intra, now_ts):
    t, c = hist.get("t") or [], hist.get("c") or []
    if not c:
        return None
    m = dict(hist.get("m") or {})
    if intra and intra.get("m"):
        m.update({k: v for k, v in intra["m"].items() if v is not None})
    tz = m.get("tz") or "UTC"
    i = len(c) - 1
    p, pc = c[i], (c[i - 1] if i > 0 else None)
    o, h, l, v, d = hist["o"][i], hist["h"][i], hist["l"][i], hist["v"][i], t[i]
    rmp, rmt, pcl = m.get("rmp"), m.get("rmt"), m.get("pcl")
    if rmp and rmt:
        rd = local_date(rmt, tz)
        if rd and rd == d:
            p = rmp
            if pcl:
                pc = pcl
        elif rd and rd > d:  # yeni seansın günlük mumu henüz oluşmamış
            pc, p, d = (pcl or c[i]), rmp, rd
            o = h = l = None
            v = 0
    q = {
        "g": group,
        "n": m.get("n"),
        "cur": m.get("cur"),
        "ex": m.get("ex"),
        "ty": m.get("ty") or special(sym),
        "tz": tz,
        "f": safe_name(sym),
        "p": p,
        "pc": pc,
        "o": o, "h": h, "l": l, "v": v,
        "d": d,
        "t": rmt,
        "h52": m.get("h52"),
        "l52": m.get("l52"),
    }
    # piyasa durumu ve seans dışı fiyat
    state = "CLOSED"
    for name, key in (("PRE", "pre"), ("REGULAR", "reg"), ("POST", "post")):
        w = m.get(key)
        if w and w[0] <= now_ts < w[1]:
            state = name
    q["ms"] = state
    if intra and intra.get("t") and m.get("reg"):
        try:
            rs, re_ = tod_minutes(m["reg"][0], tz), tod_minutes(m["reg"][1], tz)
            lt, lc = intra["t"][-1], intra["c"][-1]
            tod = tod_minutes(lt, tz)
            xs = "POST" if tod >= re_ else "PRE" if tod < rs else None
            if xs and lc and p and abs(lc / p - 1) > 0.0001 and now_ts - lt < 4 * 86400:
                q.update({"xs": xs, "xp": lc, "xt": lt})
        except Exception:
            pass
    q["sp"] = {"t": t[-SPARK_DAYS:], "c": c[-SPARK_DAYS:]}
    return {k: v for k, v in q.items() if v is not None}


def enrich(q, sym, out: Path, today: str):
    """Temel veri dosyasından sektör, piyasa değeri ve yaklaşan tarihleri market.json'a taşır."""
    rec = load_json(out / "fund" / f"{safe_name(sym)}.json")
    q["fund"] = bool(rec)
    if not rec:
        return
    prof, st, cal = rec.get("profile") or {}, rec.get("stats") or {}, rec.get("cal") or {}
    sec = prof.get("sectorDisp") or prof.get("sector")
    ind = prof.get("industryDisp") or prof.get("industry")
    if sec:
        q["sec"] = sec
    if ind:
        q["ind"] = ind
    mc = num(st.get("marketCap"))
    if not mc and num(st.get("sharesOutstanding")) and q.get("p"):
        mc = st["sharesOutstanding"] * q["p"]
    if mc:
        q["mc"] = round(mc)
    eds = cal.get("Earnings Date") or []
    if isinstance(eds, str):
        eds = [eds]
    fut = sorted(d[:10] for d in eds if isinstance(d, str) and d[:10] >= today)
    if not fut and num(st.get("earningsTimestamp")):
        d = dt.datetime.fromtimestamp(int(st["earningsTimestamp"]), UTC).strftime("%Y-%m-%d")
        if d >= today:
            fut = [d]
    if fut:
        q["ed"] = fut[0]
    exd = cal.get("Ex-Dividend Date")
    if isinstance(exd, str) and exd[:10] >= today:
        q["exd"] = exd[:10]


# ---------------------------------------------------------------- temel veriler

PROFILE_KEYS = [
    "longName", "shortName", "displayName", "sector", "sectorDisp", "industry", "industryDisp", "country", "city",
    "website", "irWebsite", "fullTimeEmployees", "longBusinessSummary", "quoteType", "exchange", "fullExchangeName",
    "currency", "financialCurrency", "category", "fundFamily", "legalType", "firstTradeDateMilliseconds",
]
STAT_KEYS = [
    "marketCap", "enterpriseValue", "trailingPE", "forwardPE", "pegRatio", "trailingPegRatio", "priceToBook",
    "priceToSalesTrailing12Months", "enterpriseToRevenue", "enterpriseToEbitda",
    "profitMargins", "grossMargins", "operatingMargins", "ebitdaMargins", "returnOnEquity", "returnOnAssets",
    "revenueGrowth", "earningsGrowth", "earningsQuarterlyGrowth",
    "totalRevenue", "grossProfits", "ebitda", "netIncomeToCommon", "operatingCashflow", "freeCashflow",
    "totalCash", "totalCashPerShare", "totalDebt", "debtToEquity", "currentRatio", "quickRatio", "bookValue",
    "revenuePerShare", "trailingEps", "forwardEps", "epsCurrentYear", "epsTrailingTwelveMonths",
    "dividendRate", "dividendYield", "payoutRatio", "exDividendDate", "lastDividendValue", "lastDividendDate",
    "trailingAnnualDividendRate", "trailingAnnualDividendYield", "fiveYearAvgDividendYield",
    "beta", "sharesOutstanding", "floatShares", "impliedSharesOutstanding", "sharesShort", "sharesShortPriorMonth",
    "shortRatio", "shortPercentOfFloat", "sharesPercentSharesOut", "dateShortInterest", "heldPercentInsiders",
    "heldPercentInstitutions", "targetMeanPrice", "targetHighPrice", "targetLowPrice", "targetMedianPrice",
    "recommendationKey", "recommendationMean", "numberOfAnalystOpinions", "averageAnalystRating",
    "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "fiftyDayAverage", "twoHundredDayAverage", "averageVolume",
    "averageVolume10days", "averageDailyVolume3Month", "earningsTimestamp", "earningsTimestampStart",
    "earningsTimestampEnd", "isEarningsDateEstimate", "lastSplitFactor", "lastSplitDate",
    "totalAssets", "yield", "netExpenseRatio", "ytdReturn", "threeYearAverageReturn", "fiveYearAverageReturn",
]
INCOME_ROWS = {
    "rev": ["TotalRevenue", "OperatingRevenue", "Total Revenue"],
    "gp": ["GrossProfit", "Gross Profit"],
    "oi": ["OperatingIncome", "Operating Income"],
    "ni": ["NetIncome", "NetIncomeCommonStockholders", "Net Income"],
    "ebitda": ["EBITDA", "NormalizedEBITDA"],
    "eps": ["DilutedEPS", "BasicEPS", "Diluted EPS"],
    "rd": ["ResearchAndDevelopment", "Research And Development"],
    "opex": ["OperatingExpense", "Operating Expense"],
}
BS_ROWS = {
    "assets": ["TotalAssets", "Total Assets"],
    "liab": ["TotalLiabilitiesNetMinorityInterest", "Total Liabilities Net Minority Interest"],
    "equity": ["StockholdersEquity", "CommonStockEquity", "Stockholders Equity"],
    "cash": ["CashCashEquivalentsAndShortTermInvestments", "CashAndCashEquivalents", "Cash And Cash Equivalents"],
    "debt": ["TotalDebt", "Total Debt"],
    "shares": ["OrdinarySharesNumber", "ShareIssued", "Ordinary Shares Number"],
}
CF_ROWS = {
    "ocf": ["OperatingCashFlow", "Operating Cash Flow"],
    "capex": ["CapitalExpenditure", "Capital Expenditure"],
    "fcf": ["FreeCashFlow", "Free Cash Flow"],
    "sbc": ["StockBasedCompensation", "Stock Based Compensation"],
    "issue": ["IssuanceOfCapitalStock", "CommonStockIssuance"],
}


def stmt(df, rows, keep):
    if df is None or not hasattr(df, "empty") or df.empty:
        return None
    try:
        cols = sorted(df.columns)[-keep:]
    except Exception:
        return None
    res = {"d": [pd.Timestamp(c).strftime("%Y-%m-%d") for c in cols]}
    for key, cands in rows.items():
        for cand in cands:
            if cand in df.index:
                row = df.loc[cand]
                if isinstance(row, pd.DataFrame):
                    row = row.iloc[0]
                vals = [num(row.get(c)) for c in cols]
                if any(v is not None for v in vals):
                    res[key] = vals
                    break
    return res if len(res) > 1 else None


def news_items(items, limit=8):
    out = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        c = it.get("content") if isinstance(it.get("content"), dict) else it
        title = c.get("title")
        url = ((c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url")
               or c.get("link") or it.get("link"))
        when = c.get("pubDate") or c.get("displayTime")
        if not when and it.get("providerPublishTime"):
            when = iso(dt.datetime.fromtimestamp(int(it["providerPublishTime"]), UTC))
        src = (c.get("provider") or {}).get("displayName") or it.get("publisher")
        if title and url:
            out.append({"title": title, "url": url, "time": when, "src": src})
        if len(out) >= limit:
            break
    return out


def fetch_fund(sym, out: Path):
    tk = yf.Ticker(sym)
    rec = {"s": sym, "upd": iso(now())}
    errs = []

    def safe(key, fn):
        try:
            return retry(fn, tries=2)
        except Exception as e:
            errs.append(f"{key}: {type(e).__name__}: {str(e)[:120]}")
            return None

    info = safe("info", tk.get_info) or {}
    if not isinstance(info, dict):
        info = {}
    rec["profile"] = {k: info[k] for k in PROFILE_KEYS if info.get(k) not in (None, "", [])}
    rec["stats"] = {k: info[k] for k in STAT_KEYS if info.get(k) not in (None, "", [], "Infinity")}
    qt = (info.get("quoteType") or "").upper()
    if qt in ("", "EQUITY"):
        rec["fin"] = {
            "y": stmt(safe("income_y", lambda: tk.get_income_stmt(freq="yearly")), INCOME_ROWS, 5),
            "q": stmt(safe("income_q", lambda: tk.get_income_stmt(freq="quarterly")), INCOME_ROWS, 8),
        }
        rec["bs"] = {
            "y": stmt(safe("bs_y", lambda: tk.get_balance_sheet(freq="yearly")), BS_ROWS, 5),
            "q": stmt(safe("bs_q", lambda: tk.get_balance_sheet(freq="quarterly")), BS_ROWS, 8),
        }
        rec["cf"] = {
            "y": stmt(safe("cf_y", lambda: tk.get_cash_flow(freq="yearly")), CF_ROWS, 5),
            "q": stmt(safe("cf_q", lambda: tk.get_cash_flow(freq="quarterly")), CF_ROWS, 8),
        }
        cal = safe("calendar", tk.get_calendar)
        if isinstance(cal, dict) and cal:
            rec["cal"] = cal
        tg = safe("targets", tk.get_analyst_price_targets)
        if isinstance(tg, dict) and tg:
            rec["targets"] = {k: num(v) for k, v in tg.items()}
        rs = safe("recs", tk.get_recommendations)
        if isinstance(rs, pd.DataFrame) and not rs.empty:
            rec["recs"] = rs.head(4).to_dict(orient="records")
        ud = safe("updown", tk.get_upgrades_downgrades)
        if isinstance(ud, pd.DataFrame) and not ud.empty:
            ud = ud.head(8).reset_index()
            rec["updown"] = [
                {"date": r.get("GradeDate") or r.get("index"), "firm": r.get("Firm"), "to": r.get("ToGrade"),
                 "from": r.get("FromGrade"), "action": r.get("Action"),
                 "pt": num(r.get("currentPriceTarget")), "ppt": num(r.get("priorPriceTarget"))}
                for r in ud.to_dict(orient="records")
            ]
        ed = safe("earnings", lambda: tk.get_earnings_dates(limit=8))
        if isinstance(ed, pd.DataFrame) and not ed.empty:
            ed = ed.reset_index()
            cols = {c.lower(): c for c in ed.columns}

            def col(*names):
                for n in names:
                    if n in cols:
                        return cols[n]
                return None

            dc, ec, rc, sc = col("earnings date", "date"), col("eps estimate"), col("reported eps"), col("surprise(%)")
            rec["eps"] = [
                {"d": r.get(dc), "est": num(r.get(ec)) if ec else None, "act": num(r.get(rc)) if rc else None,
                 "sur": num(r.get(sc)) if sc else None}
                for r in ed.to_dict(orient="records")
            ]
    if qt in ("", "EQUITY", "ETF"):
        nw = safe("news", lambda: tk.get_news(count=10))
        if nw:
            rec["news"] = news_items(nw)
    if errs:
        rec["errors"] = errs
    save_json(out / "fund" / f"{safe_name(sym)}.json", rec)
    return rec, errs


# ---------------------------------------------------------------- ana akış

def main():
    ap = argparse.ArgumentParser(description="Stocker veri toplayıcı")
    ap.add_argument("--out", default="_data", help="çıktı klasörü (veri dalı)")
    ap.add_argument("--universe", default=str(ROOT / "tickers.json"))
    ap.add_argument("--full", action="store_true", help="geçmişi ve temel verileri baştan çek")
    ap.add_argument("--only", default="", help="virgülle ayrılmış semboller (test için)")
    ap.add_argument("--fund-limit", type=int, default=30, help="bir çalıştırmada en fazla kaç temel veri")
    ap.add_argument("--no-fund", action="store_true")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    groups, bench = load_universe(Path(args.universe))
    if args.only:
        wanted = [s.strip().upper() for s in args.only.split(",") if s.strip()]
        groups = {s: groups.get(s, "P") for s in wanted}
    started = now()
    now_ts = int(started.timestamp())
    today = started.strftime("%Y-%m-%d")
    stats = {"full": 0, "daily": 0, "intra": 0, "fund": 0}
    errors = {}
    hist, intra = {}, {}

    log(f"Semboller: {len(groups)}  (portföy {sum(g == 'P' for g in groups.values())}, "
        f"endeks {sum(g == 'B' for g in groups.values())}, izleme {sum(g == 'W' for g in groups.values())})")

    # 1) günlük geçmiş + gün içi (paralel)
    def job(sym):
        g = groups[sym]
        h, fresh = fetch_daily(sym, g, out, args.full, stats)
        it = None
        if g in ("P", "B"):
            try:
                it = fetch_intraday(sym, out)
            except Exception as e:
                errors[sym + ":intraday"] = f"{type(e).__name__}: {str(e)[:120]}"
        return sym, h, it, fresh

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futs = {ex.submit(job, s): s for s in groups}
        for f in as_completed(futs):
            s = futs[f]
            try:
                sym, h, it, fresh = f.result()
                hist[sym] = h
                if it:
                    intra[sym] = it
                    stats["intra"] += 1
                if fresh:
                    stats["daily"] += 1
            except Exception as e:
                errors[s] = f"{type(e).__name__}: {str(e)[:160]}"
                old = load_json(out / "history" / f"{safe_name(s)}.json")
                if old and old.get("t"):
                    hist[s] = old
    log(f"Fiyatlar: {stats['daily']} güncellendi ({stats['full']} tam), gün içi {stats['intra']}, "
        f"hata {len(errors)}  [{(now() - started).seconds} sn]")

    # 2) market.json
    old_market = load_json(out / "market.json", {}) or {}
    quotes = {}
    for sym, g in groups.items():
        h = hist.get(sym)
        if not h:
            continue
        it = intra.get(sym)
        if not it and g in ("P", "B"):
            it = load_json(out / "intraday" / f"{safe_name(sym)}.json")
        try:
            q = build_quote(sym, g, h, it, now_ts)
        except Exception as e:
            errors[sym + ":quote"] = f"{type(e).__name__}: {str(e)[:120]}"
            q = None
        if q:
            enrich(q, sym, out, today)
            quotes[sym] = q
    if args.only and old_market.get("quotes"):  # test çalıştırmasında diğer sembolleri koru
        merged = dict(old_market["quotes"])
        merged.update(quotes)
        quotes = merged

    def fxp(s):
        q = quotes.get(s)
        return q.get("p") if q else None

    fx = {k: v for k, v in {"USDTRY": fxp("USDTRY=X"), "EURTRY": fxp("EURTRY=X"), "EURUSD": fxp("EURUSD=X")}.items() if v}
    market = {
        "v": 1,
        "generated": iso(now()),
        "fx": fx,
        "benchmarks": bench,
        "quotes": quotes,
        "errors": errors,
    }
    save_json(out / "market.json", market)

    # 3) temel veriler (sırayla, nazikçe)
    if not args.no_fund:
        cands = []
        for sym, g in groups.items():
            if special(sym) or sym not in quotes:
                continue
            ty = (quotes[sym].get("ty") or "").upper()
            if ty not in ("EQUITY", "ETF", ""):
                continue
            rec = load_json(out / "fund" / f"{safe_name(sym)}.json")
            upd = parse_iso((rec or {}).get("upd", "")) if rec else None
            age = (started - upd) if upd else dt.timedelta(days=9999)
            if args.full or age > FUND_EVERY.get(g, FUND_EVERY["W"]):
                cands.append((0 if g == "P" else 1, -age.total_seconds(), sym))
        cands.sort()
        todo = [s for _, _, s in cands[: max(0, args.fund_limit)]]
        log(f"Temel veri: {len(todo)} / {len(cands)} sembol")
        for sym in todo:
            try:
                _, errs = fetch_fund(sym, out)
                stats["fund"] += 1
                if errs:
                    errors[sym + ":fund"] = "; ".join(errs)[:300]
            except Exception as e:
                errors[sym + ":fund"] = f"{type(e).__name__}: {str(e)[:160]}"
            time.sleep(0.3 + random.random() * 0.3)
        for sym in quotes:
            if sym in groups:
                enrich(quotes[sym], sym, out, today)
        market["errors"] = errors
        market["generated"] = iso(now())
        save_json(out / "market.json", market)

    took = (now() - started).seconds
    log(f"Bitti: {len(quotes)} sembol, temel {stats['fund']}, hata {len(errors)}, {took} sn")
    for k, v in sorted(errors.items()):
        log(f"  ! {k}: {v}")
    ok = len(quotes) > 0
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        sys.exit(1)
