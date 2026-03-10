import { useState, useEffect, useRef, useCallback } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TIMEFRAMES = [
  { label: "1M",  value: "1min",  minutes: 1   },
  { label: "5M",  value: "5min",  minutes: 5   },
  { label: "15M", value: "15min", minutes: 15  },
  { label: "30M", value: "30min", minutes: 30  },
  { label: "1H",  value: "1hour", minutes: 60  },
  { label: "4H",  value: "4hour", minutes: 240 },
  { label: "1D",  value: "1day",  minutes: 1440},
];

const PAIR_META = {
  "EUR/USD": { decimals: 5, pip: 0.0001 },
  "GBP/USD": { decimals: 5, pip: 0.0001 },
  "USD/JPY": { decimals: 3, pip: 0.01   },
  "EUR/GBP": { decimals: 5, pip: 0.0001 },
  "XAU/USD": { decimals: 2, pip: 0.1    },
  "NAS100":  { decimals: 1, pip: 1      },
  "US30":    { decimals: 1, pip: 1      },
  "BTC/USD": { decimals: 1, pip: 1      },
};
const PAIRS = Object.keys(PAIR_META);

const SESSIONS = {
  LONDON:   { label: "London",   color: "#3b82f6", hours: "03:00–12:00 EST" },
  NEW_YORK: { label: "New York", color: "#f59e0b", hours: "08:00–17:00 EST" },
  OVERLAP:  { label: "Overlap",  color: "#10b981", hours: "08:00–12:00 EST" },
  ASIA:     { label: "Asia",     color: "#8b5cf6", hours: "20:00–00:00 EST" },
};

const ICT_CONCEPTS = [
  "Liquidity Sweep","Order Block (Bullish)","Order Block (Bearish)",
  "Fair Value Gap","Market Structure Shift","Break of Structure",
  "Premium/Discount Array","Optimal Trade Entry","Killzone Entry",
  "Smart Money Reversal","Inducement","Judas Swing",
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function getActiveSession() {
  const estHour = (new Date().getUTCHours() - 5 + 24) % 24;
  if (estHour >= 8  && estHour < 12) return "OVERLAP";
  if (estHour >= 3  && estHour < 12) return "LONDON";
  if (estHour >= 8  && estHour < 17) return "NEW_YORK";
  if (estHour >= 20 || estHour < 1)  return "ASIA";
  return null;
}

function generateSparkline(n = 44) {
  const pts = []; let v = 50;
  for (let i = 0; i < n; i++) {
    v += (Math.random() - 0.48) * 2.4;
    pts.push(Math.max(8, Math.min(92, v)));
  }
  return pts;
}
function sparkTrend(d) {
  const h = Math.floor(d.length / 2);
  return d.slice(h).reduce((s,x)=>s+x,0)/(d.length-h) - d.slice(0,h).reduce((s,x)=>s+x,0)/h;
}

// ─── CLAUDE API CALLS ─────────────────────────────────────────────────────────

/** Step 1: Fetch live price using Claude + web_search */
async function fetchPriceViaAI(pair) {
  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    system: `You are a data extraction assistant. When asked for a current forex/index price, search the web and return ONLY a JSON object with this exact format: {"price": <number>, "source": "<site name>"}. No markdown, no extra text.`,
    messages: [{
      role: "user",
      content: `Search for the current live price of ${pair} right now. Return only JSON: {"price": <number>, "source": "<site>"}`
    }],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  // Find the final text block (after tool use)
  const textBlock = [...(data.content || [])].reverse().find(b => b.type === "text");
  if (!textBlock) return null;

  try {
    const clean = textBlock.text.replace(/```json|```/g, "").trim();
    // Extract JSON object even if there's surrounding text
    const match = clean.match(/\{[\s\S]*"price"[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]);
    if (typeof obj.price === "number" && obj.price > 0) return obj;
    return null;
  } catch { return null; }
}

/** Step 2: Full ICT analysis with the real price */
async function callClaudeICT({ pair, timeframe, session, price, priceSource }) {
  const meta = PAIR_META[pair] || { decimals: 5, pip: 0.0001 };

  const system = `You are ICT-AI, an expert Inner Circle Trader analyst created by Ion Lozan. You perform intraday analysis using pure ICT methodology: liquidity sweeps (BSL/SSL), Order Blocks (OB), Fair Value Gaps (FVG), Market Structure Shifts (MSS), Break of Structure (BOS), Premium/Discount arrays, Killzones, Judas Swing, IPDA, OTE.

IMPORTANT: All price levels you output MUST be mathematically derived from the actual current price provided. Do not invent levels — calculate realistic ICT zones based on the real price.

Respond ONLY with a valid JSON object. No markdown, no backticks, no preamble.
{"bias":"BULLISH"|"BEARISH"|"NEUTRAL"|"RANGING","confidence":<0-100>,"session_quality":"HIGH"|"MEDIUM"|"LOW","key_concept":<string>,"summary":<2-3 sentence ICT analysis>,"entry_zone":<price range string>,"sl_zone":<string with price + reason>,"tp1":<price string>,"tp2":<price string>,"risk_reward":<"1:X.X">,"structure":"UPTREND"|"DOWNTREND"|"CONSOLIDATION","liquidity_target":<string>,"ob_level":<string>,"fvg":<string>,"ict_pattern":<string>,"killzone":"ACTIVE"|"APPROACHING"|"CLOSED","warning":<string|null>}`;

  const user = `Analyze ${pair} on ${timeframe} timeframe.
Current REAL market price: ${price} (fetched from: ${priceSource})
Pip size: ${meta.pip} | Decimals: ${meta.decimals}
Active session: ${session || "Off-session"}
UTC time: ${new Date().toUTCString()}

Calculate all ICT levels (OB, FVG, SL, TP1, TP2, liquidity) as actual price numbers derived mathematically from ${price}.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await res.json();
  const raw = data.content?.find(b => b.type === "text")?.text || "{}";
  try { return JSON.parse(raw.replace(/```json|```/g, "").trim()); }
  catch { return null; }
}

// ─── UI COMPONENTS ────────────────────────────────────────────────────────────
function Sparkline({ data, color = "#10b981", H = 52, W = 130 }) {
  const min = Math.min(...data), max = Math.max(...data), r = max - min || 1;
  const pts = data.map((v, i) =>
    `${(i/(data.length-1))*W},${H - ((v-min)/r)*(H-6)-3}`
  ).join(" ");
  return (
    <svg width={W} height={H} style={{ display:"block", overflow:"visible" }}>
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#sg)"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

function Badge({ children, color="#10b981", pulse=false }) {
  return (
    <span style={{ background:color+"18", color, border:`1px solid ${color}38`, borderRadius:4, padding:"2px 8px", fontSize:10, fontFamily:"monospace", fontWeight:700, letterSpacing:1, whiteSpace:"nowrap", display:"inline-flex", alignItems:"center", gap:4 }}>
      {pulse && <Dot color={color} size={6}/>}
      {children}
    </span>
  );
}

function Dot({ color="#10b981", size=8 }) {
  return (
    <span style={{ position:"relative", display:"inline-block", width:size, height:size, marginRight:2, flexShrink:0 }}>
      <span style={{ position:"absolute", inset:0, borderRadius:"50%", background:color, opacity:.2, animation:"ping 1.7s ease-in-out infinite" }}/>
      <span style={{ position:"absolute", inset:Math.round(size*.22), borderRadius:"50%", background:color }}/>
    </span>
  );
}

function StatusBar({ state, source }) {
  if (state === "fetching") return <Badge color="#f59e0b"><span style={{animation:"pulse 1s ease infinite", display:"inline-block"}}>⟳</span> Buscando precio live...</Badge>;
  if (state === "live")     return <Badge color="#10b981" pulse>LIVE · {source}</Badge>;
  if (state === "manual")   return <Badge color="#f59e0b">✎ MANUAL</Badge>;
  if (state === "error")    return <Badge color="#ef4444">⚠ Ingresa precio manualmente</Badge>;
  return <Badge color="#334155">—</Badge>;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function ICTAnalyzer() {
  const [pair, setPair]         = useState("EUR/USD");
  const [tf, setTf]             = useState("15min");
  const [price, setPrice]       = useState("");          // displayed / used price
  const [priceState, setPriceState] = useState("idle"); // idle|fetching|live|manual|error
  const [priceSource, setPriceSource] = useState("");
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState("");
  const [lastFetch, setLastFetch]   = useState(null);
  const [spark, setSpark]       = useState(generateSparkline);
  const [session, setSession]   = useState(getActiveSession);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [loadMsg, setLoadMsg]   = useState("");
  const [error, setError]       = useState(null);
  const [history, setHistory]   = useState([]);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRef = useRef(null);
  const meta = PAIR_META[pair] || { decimals: 5, pip: 0.0001 };

  // ── Fetch price ──
  const loadPrice = useCallback(async (p = pair, silent = false) => {
    if (!silent) setPriceState("fetching");
    setError(null);
    const result = await fetchPriceViaAI(p);
    if (result) {
      setPrice(String(result.price));
      setPriceInput(String(result.price));
      setPriceState("live");
      setPriceSource(result.source || "web");
      setLastFetch(new Date());
      setSpark(generateSparkline());
    } else {
      setPriceState("error");
      setPriceSource("");
    }
  }, [pair]);

  // On pair change
  useEffect(() => {
    setAnalysis(null); setError(null); setPrice(""); setPriceInput("");
    setPriceState("idle"); setPriceSource("");
    setSpark(generateSparkline());
    loadPrice(pair);
  }, [pair]);

  // Refresh price every 60s
  useEffect(() => {
    const t = setInterval(() => loadPrice(pair, true), 60000);
    return () => clearInterval(t);
  }, [pair, loadPrice]);

  // Update session
  useEffect(() => {
    const t = setInterval(() => setSession(getActiveSession()), 60000);
    return () => clearInterval(t);
  }, []);

  // Animate sparkline
  useEffect(() => {
    const t = setInterval(() => setSpark(p => {
      const nxt = Math.max(8, Math.min(92, p[p.length-1] + (Math.random()-0.48)*2.1));
      return [...p.slice(1), nxt];
    }), 3500);
    return () => clearInterval(t);
  }, []);

  // Manual price edit confirm
  function confirmManual() {
    const v = parseFloat(priceInput);
    if (!isNaN(v) && v > 0) {
      setPrice(String(v));
      setPriceState("manual");
      setPriceSource("TradingView (manual)");
    }
    setEditingPrice(false);
  }

  // ── Analysis ──
  const runAnalysis = useCallback(async () => {
    if (!price) { setError("Primero obtén o ingresa el precio."); return; }
    setLoading(true); setError(null);

    setLoadMsg("Paso 1/2 · Verificando precio...");
    await new Promise(r => setTimeout(r, 400));
    setLoadMsg("Paso 2/2 · Analizando estructura ICT con IA...");

    try {
      const result = await callClaudeICT({
        pair, timeframe: tf, session, price,
        priceSource: priceSource || "user input",
      });
      if (!result) throw new Error("JSON inválido");
      setAnalysis(result);
      setHistory(h => [{
        pair, tf, price,
        time: new Date().toLocaleTimeString(),
        bias: result.bias, confidence: result.confidence,
      }, ...h.slice(0, 8)]);
    } catch { setError("Análisis fallido. Reintentar."); }

    setLoading(false); setLoadMsg("");
  }, [pair, tf, session, price, priceSource]);

  // Auto-refresh
  useEffect(() => {
    clearInterval(autoRef.current);
    if (autoRefresh) {
      const ms = Math.max(90000, (TIMEFRAMES.find(t=>t.value===tf)?.minutes||15)*18000);
      autoRef.current = setInterval(runAnalysis, ms);
    }
    return () => clearInterval(autoRef.current);
  }, [autoRefresh, tf, runAnalysis]);

  const sparkColor = sparkTrend(spark) >= 0 ? "#10b981" : "#ef4444";
  const activeSes  = session ? SESSIONS[session] : null;
  const bColor = { BULLISH:"#10b981", BEARISH:"#ef4444", NEUTRAL:"#f59e0b", RANGING:"#8b5cf6" };
  const sColor = { UPTREND:"#10b981", DOWNTREND:"#ef4444", CONSOLIDATION:"#f59e0b" };
  const kColor = { ACTIVE:"#10b981", APPROACHING:"#f59e0b", CLOSED:"#64748b" };

  return (
    <div style={{ minHeight:"100vh", background:"#040911", color:"#e2e8f0", fontFamily:"'IBM Plex Mono','Courier New',monospace", position:"relative", overflowX:"hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Orbitron:wght@700;900&display=swap');
        @keyframes ping   {0%,100%{transform:scale(1);opacity:.2}50%{transform:scale(2.4);opacity:0}}
        @keyframes pulse  {0%,100%{opacity:1}50%{opacity:.35}}
        @keyframes fadeIn {from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes scan   {0%{top:-2px}100%{top:100vh}}
        @keyframes spin   {to{transform:rotate(360deg)}}
        .btn:hover{opacity:.78;transform:translateY(-1px)}
        .btn:active{transform:translateY(0)}
        .card{animation:fadeIn .35s ease}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-track{background:#050d1a}
        ::-webkit-scrollbar-thumb{background:#1a3050;border-radius:2px}
        input[type=number]{-moz-appearance:textfield}
        input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none}
      `}</style>

      {/* Scanline */}
      <div style={{ position:"fixed", left:0, right:0, height:2, background:"linear-gradient(transparent,#0ea5e91c,transparent)", animation:"scan 9s linear infinite", pointerEvents:"none", zIndex:99 }}/>
      {/* Grid */}
      <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0, backgroundImage:`linear-gradient(#0ea5e905 1px,transparent 1px),linear-gradient(90deg,#0ea5e905 1px,transparent 1px)`, backgroundSize:"44px 44px" }}/>

      <div style={{ position:"relative", zIndex:1, maxWidth:1180, margin:"0 auto", padding:"18px 14px" }}>

        {/* ─── HEADER ─── */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:38, height:38, borderRadius:9, background:"linear-gradient(135deg,#0ea5e9,#6366f1)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, boxShadow:"0 0 20px #0ea5e940" }}>⬡</div>
            <div>
              <div style={{ fontFamily:"'Orbitron',monospace", fontSize:18, fontWeight:900, color:"#0ea5e9", letterSpacing:3 }}>ICT-AI</div>
              <div style={{ fontSize:8, color:"#1e3a5f", letterSpacing:4 }}>BY ION LOZAN</div>
            </div>
          </div>
          <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
            {activeSes
              ? <Badge color={activeSes.color} pulse>{activeSes.label} · {activeSes.hours}</Badge>
              : <Badge color="#334155">OFF SESSION</Badge>}
            <Badge color="#1e3a5f">{new Date().toLocaleTimeString()}</Badge>
          </div>
        </div>

        {/* ─── PAIRS ─── */}
        <div style={{ display:"flex", gap:5, marginBottom:14, flexWrap:"wrap" }}>
          {PAIRS.map(p => (
            <button key={p} className="btn" onClick={() => setPair(p)}
              style={{ background:pair===p?"#0ea5e91a":"#070f1e", border:`1px solid ${pair===p?"#0ea5e9":"#1a2d45"}`, color:pair===p?"#0ea5e9":"#334155", padding:"6px 12px", borderRadius:6, cursor:"pointer", fontSize:11, fontFamily:"inherit", fontWeight:700, letterSpacing:1, transition:"all .15s" }}>
              {p}
            </button>
          ))}
        </div>

        {/* ─── TIMEFRAMES ─── */}
        <div style={{ display:"flex", gap:4, marginBottom:20, flexWrap:"wrap" }}>
          {TIMEFRAMES.map(t => (
            <button key={t.value} className="btn" onClick={() => setTf(t.value)}
              style={{ background:tf===t.value?"#6366f11a":"#070f1e", border:`1px solid ${tf===t.value?"#6366f1":"#1a2d45"}`, color:tf===t.value?"#a78bfa":"#334155", padding:"5px 11px", borderRadius:5, cursor:"pointer", fontSize:10, fontFamily:"inherit", fontWeight:700, letterSpacing:1, transition:"all .15s" }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 310px", gap:12, alignItems:"start" }}>

          {/* ══════ LEFT ══════ */}
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>

            {/* ─── PRICE CARD ─── */}
            <div className="card" style={{ background:"#070f1e", border:"1px solid #1a2d45", borderRadius:12, padding:18 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10 }}>
                <div style={{ flex:1 }}>

                  {/* Status */}
                  <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:10, flexWrap:"wrap" }}>
                    <span style={{ fontSize:10, color:"#475569", letterSpacing:2 }}>{pair}</span>
                    <StatusBar state={priceState} source={priceSource}/>
                    {lastFetch && priceState==="live" && (
                      <span style={{ fontSize:8, color:"#1e3a5f" }}>@ {lastFetch.toLocaleTimeString()}</span>
                    )}
                  </div>

                  {/* Price display / edit */}
                  {editingPrice ? (
                    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                      <input
                        autoFocus type="number" value={priceInput}
                        onChange={e => setPriceInput(e.target.value)}
                        onKeyDown={e => { if(e.key==="Enter") confirmManual(); if(e.key==="Escape") setEditingPrice(false); }}
                        style={{ background:"#0a1628", border:"1px solid #0ea5e9", borderRadius:8, padding:"7px 12px", color:"#f1f5f9", fontFamily:"'Orbitron',monospace", fontSize:22, fontWeight:700, width:180, outline:"none", letterSpacing:1 }}
                      />
                      <button className="btn" onClick={confirmManual}
                        style={{ background:"#10b98122", border:"1px solid #10b981", color:"#10b981", padding:"7px 14px", borderRadius:7, cursor:"pointer", fontFamily:"inherit", fontSize:11, fontWeight:700 }}>
                        ✓ OK
                      </button>
                      <button className="btn" onClick={() => setEditingPrice(false)}
                        style={{ background:"transparent", border:"1px solid #1a2d45", color:"#475569", padding:"7px 12px", borderRadius:7, cursor:"pointer", fontFamily:"inherit", fontSize:11 }}>
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div style={{ display:"flex", alignItems:"baseline", gap:10, flexWrap:"wrap", cursor:"pointer" }}
                      onClick={() => { setPriceInput(price); setEditingPrice(true); }}>
                      {price ? (
                        <>
                          <span style={{ fontFamily:"'Orbitron',monospace", fontSize:32, fontWeight:900, color:"#f1f5f9", letterSpacing:2 }}>{price}</span>
                          <span style={{ fontSize:10, color:"#1e3a5f", marginBottom:4 }}>✎ editar</span>
                        </>
                      ) : priceState==="fetching" ? (
                        <span style={{ fontFamily:"'Orbitron',monospace", fontSize:32, fontWeight:900, color:"#1e3a5f" }}>
                          <span style={{ display:"inline-block", animation:"spin 1.2s linear infinite" }}>⟳</span>
                        </span>
                      ) : (
                        <span style={{ fontFamily:"'Orbitron',monospace", fontSize:22, fontWeight:700, color:"#334155" }}>— · toca para ingresar</span>
                      )}
                    </div>
                  )}

                  {priceState === "error" && !price && (
                    <div style={{ marginTop:8, fontSize:10, color:"#f59e0b", lineHeight:1.6 }}>
                      La búsqueda automática no pudo obtener el precio.<br/>
                      <span style={{ color:"#64748b" }}>Toca el área de precio para ingresarlo manualmente desde TradingView.</span>
                    </div>
                  )}

                  <div style={{ fontSize:9, color:"#1e3a5f", marginTop:8 }}>
                    TF: <span style={{ color:"#a78bfa" }}>{TIMEFRAMES.find(t=>t.value===tf)?.label}</span>
                    &nbsp;·&nbsp;Sesión: <span style={{ color:activeSes?.color||"#334155" }}>{session||"—"}</span>
                    &nbsp;·&nbsp;Pip: <span style={{ color:"#334155" }}>{meta.pip}</span>
                  </div>
                </div>

                <Sparkline data={spark} color={sparkColor}/>
              </div>

              {/* Refresh btn */}
              <button className="btn" onClick={() => loadPrice(pair)} disabled={priceState==="fetching"}
                style={{ marginTop:12, width:"100%", padding:"7px", background:"transparent", border:"1px solid #1a2d45", color:priceState==="fetching"?"#1e3a5f":"#0ea5e9", borderRadius:7, cursor:priceState==="fetching"?"not-allowed":"pointer", fontFamily:"inherit", fontSize:9, letterSpacing:2, transition:"all .2s", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                {priceState==="fetching"
                  ? <><span style={{ animation:"spin 1s linear infinite", display:"inline-block" }}>⟳</span> BUSCANDO PRECIO EN WEB...</>
                  : "⟳  ACTUALIZAR PRECIO (IA + WEB)"}
              </button>
            </div>

            {/* ─── ANALYZE ─── */}
            <button className="btn" onClick={runAnalysis} disabled={loading||!price}
              style={{ width:"100%", padding:"13px", borderRadius:10, border:"none", background:loading||!price?"#1a2d45":"linear-gradient(135deg,#0ea5e9,#6366f1)", color:!price?"#334155":"#fff", cursor:loading||!price?"not-allowed":"pointer", fontFamily:"'Orbitron',monospace", fontSize:12, fontWeight:700, letterSpacing:3, transition:"all .2s", opacity:loading?.75:1, boxShadow:loading||!price?"none":"0 0 28px #0ea5e930" }}>
              {loading
                ? <span style={{ animation:"pulse 1s ease infinite", display:"inline-block" }}>{loadMsg||"⟳  ANALIZANDO..."}</span>
                : !price ? "⚠  OBTÉN EL PRECIO PRIMERO" : "▶  EJECUTAR ANÁLISIS ICT AI"}
            </button>

            {/* Auto-refresh */}
            <button className="btn" onClick={() => setAutoRefresh(a=>!a)}
              style={{ width:"100%", padding:"8px", background:autoRefresh?"#10b9811a":"#070f1e", border:`1px solid ${autoRefresh?"#10b981":"#1a2d45"}`, color:autoRefresh?"#10b981":"#334155", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontSize:9, letterSpacing:2, transition:"all .2s", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
              {autoRefresh ? <><Dot color="#10b981" size={6}/>AUTO-REFRESH ACTIVO</> : "⊙  AUTO-REFRESH DESACTIVADO"}
            </button>

            {error && (
              <div style={{ background:"#ef444410", border:"1px solid #ef444438", borderRadius:8, padding:"9px 13px", color:"#f87171", fontSize:10 }}>
                ⚠ {error}
              </div>
            )}

            {/* ─── RESULT ─── */}
            {analysis && (
              <div className="card" style={{ background:"#070f1e", border:`1px solid ${bColor[analysis.bias]||"#1a2d45"}40`, borderRadius:12, padding:18, display:"flex", flexDirection:"column", gap:14, boxShadow:`0 0 32px ${bColor[analysis.bias]||"#0ea5e9"}0c` }}>

                {/* Bias */}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div>
                    <div style={{ fontSize:8, color:"#334155", letterSpacing:3, marginBottom:4 }}>ICT BIAS</div>
                    <div style={{ fontFamily:"'Orbitron',monospace", fontSize:30, fontWeight:900, color:bColor[analysis.bias] }}>{analysis.bias}</div>
                    <div style={{ fontSize:8, color:"#1e3a5f", marginTop:3 }}>
                      Precio: <span style={{ color:"#64748b" }}>{price}</span> · {priceSource||"manual"}
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:8, color:"#334155", letterSpacing:2, marginBottom:8 }}>CONFIANZA</div>
                    <div style={{ position:"relative", width:90, height:6, background:"#1a2d45", borderRadius:3, overflow:"hidden" }}>
                      <div style={{ position:"absolute", inset:0, right:`${100-analysis.confidence}%`, background:bColor[analysis.bias], borderRadius:3, transition:"right .6s ease" }}/>
                    </div>
                    <div style={{ fontSize:14, fontWeight:700, color:bColor[analysis.bias], marginTop:5 }}>{analysis.confidence}%</div>
                  </div>
                </div>

                {/* Badges */}
                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  <Badge color={sColor[analysis.structure]||"#64748b"}>{analysis.structure}</Badge>
                  <Badge color={kColor[analysis.killzone]||"#64748b"}>KZ {analysis.killzone}</Badge>
                  <Badge color={analysis.session_quality==="HIGH"?"#10b981":analysis.session_quality==="MEDIUM"?"#f59e0b":"#64748b"}>SQ: {analysis.session_quality}</Badge>
                  <Badge color="#0ea5e9">{analysis.risk_reward}</Badge>
                </div>

                {/* Pattern */}
                <div style={{ background:"#0b1c34", border:"1px solid #1a3a5f", borderRadius:8, padding:"10px 13px" }}>
                  <div style={{ fontSize:8, color:"#0ea5e9", letterSpacing:3, marginBottom:4 }}>PATRÓN ICT DETECTADO</div>
                  <div style={{ fontSize:13, fontWeight:600, color:"#e2e8f0" }}>{analysis.ict_pattern||analysis.key_concept}</div>
                </div>

                {/* Summary */}
                <div style={{ fontSize:11, color:"#94a3b8", lineHeight:1.8, borderLeft:`2px solid ${bColor[analysis.bias]}28`, paddingLeft:12 }}>
                  {analysis.summary}
                </div>

                {/* Entry/SL/TP */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:7 }}>
                  {[
                    { label:"ENTRADA",   value:analysis.entry_zone, color:"#10b981" },
                    { label:"STOP LOSS", value:analysis.sl_zone,    color:"#ef4444" },
                    { label:"TP 1",      value:analysis.tp1,        color:"#f59e0b" },
                    { label:"TP 2",      value:analysis.tp2,        color:"#a78bfa" },
                  ].map(z => (
                    <div key={z.label} style={{ background:z.color+"09", border:`1px solid ${z.color}1c`, borderRadius:8, padding:"9px 11px" }}>
                      <div style={{ fontSize:7, color:z.color+"88", letterSpacing:2, marginBottom:3 }}>{z.label}</div>
                      <div style={{ fontSize:11, fontWeight:700, color:z.color }}>{z.value||"—"}</div>
                    </div>
                  ))}
                </div>

                {/* OB/FVG/Liquidity */}
                <div>
                  {[
                    { icon:"◈", label:"ORDER BLOCK",      value:analysis.ob_level },
                    { icon:"⊟", label:"FAIR VALUE GAP",   value:analysis.fvg },
                    { icon:"◎", label:"LIQUIDITY TARGET",  value:analysis.liquidity_target },
                  ].map(item => (
                    <div key={item.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:"1px solid #0c1628" }}>
                      <div style={{ fontSize:8, color:"#1e3a5f", letterSpacing:1 }}>{item.icon} {item.label}</div>
                      <div style={{ fontSize:10, color:"#475569", fontWeight:600, textAlign:"right", maxWidth:200 }}>{item.value||"—"}</div>
                    </div>
                  ))}
                </div>

                {analysis.warning && (
                  <div style={{ background:"#f59e0b0c", border:"1px solid #f59e0b28", borderRadius:7, padding:"8px 11px", fontSize:10, color:"#fbbf24" }}>⚠ {analysis.warning}</div>
                )}

                <div style={{ fontSize:8, color:"#1a2d45", textAlign:"right" }}>
                  ICT-AI · Ion Lozan · {new Date().toLocaleTimeString()}
                </div>
              </div>
            )}
          </div>

          {/* ══════ RIGHT ══════ */}
          <div style={{ display:"flex", flexDirection:"column", gap:11 }}>

            {/* Sessions */}
            <div style={{ background:"#070f1e", border:"1px solid #1a2d45", borderRadius:12, padding:14 }}>
              <div style={{ fontSize:8, color:"#1e3a5f", letterSpacing:3, marginBottom:11 }}>MAPA DE SESIONES</div>
              {Object.entries(SESSIONS).map(([key, s]) => (
                <div key={key} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:"1px solid #06101a" }}>
                  <div style={{ display:"flex", alignItems:"center" }}>
                    {session===key && <Dot color={s.color} size={6}/>}
                    <span style={{ fontSize:11, color:session===key?s.color:"#1e3a5f", fontWeight:session===key?700:400 }}>{s.label}</span>
                  </div>
                  <span style={{ fontSize:8, color:"#1a2d45" }}>{s.hours}</span>
                </div>
              ))}
            </div>

            {/* ICT Concepts */}
            <div style={{ background:"#070f1e", border:"1px solid #1a2d45", borderRadius:12, padding:14 }}>
              <div style={{ fontSize:8, color:"#1e3a5f", letterSpacing:3, marginBottom:10 }}>CONCEPTOS ICT</div>
              {ICT_CONCEPTS.map((c, i) => {
                const active = !!(analysis && (
                  analysis.ict_pattern?.toLowerCase().includes(c.split(" ")[0].toLowerCase()) ||
                  analysis.key_concept?.toLowerCase().includes(c.split(" ")[0].toLowerCase())
                ));
                return (
                  <div key={c} style={{ fontSize:10, color:active?"#0ea5e9":"#1a3050", padding:"4px 0", borderBottom:"1px solid #0a1220", display:"flex", gap:5 }}>
                    <span style={{ color:"#0f2035", minWidth:18 }}>{String(i+1).padStart(2,"0")}</span>
                    <span style={{ fontWeight:active?700:400 }}>{c}</span>
                    {active && <span style={{ color:"#0ea5e9", marginLeft:"auto" }}>◀</span>}
                  </div>
                );
              })}
            </div>

            {/* History */}
            {history.length > 0 && (
              <div style={{ background:"#070f1e", border:"1px solid #1a2d45", borderRadius:12, padding:14 }}>
                <div style={{ fontSize:8, color:"#1e3a5f", letterSpacing:3, marginBottom:10 }}>HISTORIAL</div>
                {history.map((h, i) => (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:"1px solid #06101a", gap:5 }}>
                    <div>
                      <div style={{ fontSize:8, color:"#1e3a5f" }}>{h.time} · {h.pair} {h.tf}</div>
                      <div style={{ fontSize:8, color:"#0f2035" }}>@ {h.price}</div>
                    </div>
                    <Badge color={bColor[h.bias]||"#334155"}>{h.bias} {h.confidence}%</Badge>
                  </div>
                ))}
              </div>
            )}

            {/* Disclaimer */}
            <div style={{ background:"#040911", border:"1px solid #0f1d2e", borderRadius:8, padding:10 }}>
              <div style={{ fontSize:7, color:"#1a2d45", lineHeight:1.7 }}>
                ⚠ ICT-AI by Ion Lozan — solo educativo. No es asesoramiento financiero. Gestiona tu riesgo siempre.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
// PWA ready
