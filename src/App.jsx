import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  Mic,
  Square,
  Keyboard,
  Check,
  RotateCcw,
  BookmarkPlus,
  Trash2,
  History,
  X,
  ChevronRight,
  ChevronLeft,
  Volume2,
  Repeat,
  Gauge,
  Shuffle,
  Loader2,
} from "lucide-react";

const STOPWORDS = new Set(
  `a an the and or but if then else so as at by for from in into of on onto to with without about above below over under
   is are was were be been being am do does did doing done have has had having will would shall should can could may might must
   i you he she it we they me him her us them my your his its our their mine yours hers ours theirs this that these those
   there here what which who whom whose why how when where than not no yes just very too also only`
    .split(/\s+/)
);

const normalizeWord = (w) =>
  w.toLowerCase().replace(/[.,!?;:"'()\[\]{}—–\-]/g, "").replace(/'s$/, "").trim();

const tokenize = (s) =>
  s.trim().split(/\s+/).map(normalizeWord).filter(Boolean);

const contentWords = (s) =>
  tokenize(s).filter((w) => !STOPWORDS.has(w) && w.length > 1);

const compareContent = (refText, hypText) => {
  const refWords = contentWords(refText);
  const hypWords = contentWords(hypText);
  const refSet = new Set(refWords);
  const hypSet = new Set(hypWords);
  const matched = refWords.filter((w) => hypSet.has(w));
  const missing = refWords.filter((w) => !hypSet.has(w));
  const extra = hypWords.filter((w) => !refSet.has(w));
  const uniqueMatched = new Set(matched).size;
  const uniqueRef = refSet.size;
  const score = uniqueRef > 0 ? Math.round((uniqueMatched / uniqueRef) * 100) : 0;
  return {
    matched: [...new Set(matched)],
    missing: [...new Set(missing)],
    extra: [...new Set(extra)],
    score,
  };
};

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

const flattenToSegments = (part, difficulty, item, part2Mode) => {
  if (part === 1) {
    return [{ text: item.text, speaker: "narrator" }];
  }
  if (part === 2) {
    if (part2Mode === "question") {
      return [
        {
          text: item.question,
          speaker: "narrator",
          note: `想定される応答: ${item.answer}`,
        },
      ];
    }
    return [
      { text: item.question, speaker: "narrator", label: "Q" },
      { text: item.answer, speaker: "narrator", label: "A" },
    ];
  }
  if (part === 3 || part === 4) {
    return item.items.map((it) => ({
      text: it.text,
      speaker: it.speaker || "narrator",
    }));
  }
  return [];
};

const buildSession = (data, part, difficulty, part2Mode, sessionSize = 5) => {
  const pool = data[`part${part}`][difficulty];
  if (!pool || pool.length === 0) return { segments: [], context: null };
  if (part === 1 || part === 2) {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, Math.min(sessionSize, pool.length));
    const segs = [];
    picked.forEach((it, i) => {
      const s = flattenToSegments(part, difficulty, it, part2Mode);
      s.forEach((seg) => {
        segs.push({ ...seg, label: seg.label ? `${i + 1}-${seg.label}` : `${i + 1}` });
      });
    });
    return { segments: segs, context: null };
  }
  const item = pickRandom(pool);
  return { segments: flattenToSegments(part, difficulty, item), context: item.context };
};

const pickVoices = () => {
  if (!window.speechSynthesis) return {};
  const voices = window.speechSynthesis.getVoices().filter((v) =>
    v.lang.toLowerCase().startsWith("en")
  );
  if (voices.length === 0) return {};
  const female = voices.find((v) =>
    /female|samantha|victoria|karen|allison|serena|zoe|kate|susan|zira|hazel/i.test(v.name)
  );
  const male = voices.find(
    (v) =>
      /male|daniel|alex|fred|tom|david|george|arthur|oliver|mark/i.test(v.name) &&
      v !== female
  );
  return {
    M: male || voices[0],
    W: female || voices[voices.length > 1 ? 1 : 0],
    narrator: voices[0],
  };
};

export default function App() {
  const [data, setData] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [part, setPart] = useState(3);
  const [difficulty, setDifficulty] = useState("medium");
  const [part2Mode, setPart2Mode] = useState("both");
  const [sessionContext, setSessionContext] = useState(null);
  const [segments, setSegments] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [phase, setPhase] = useState("setup");
  const [speed, setSpeed] = useState(0.9);
  const [inputMode, setInputMode] = useState("keyboard");
  const [hyp, setHyp] = useState("");
  const [checked, setChecked] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState(null);
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const [reviewList, setReviewList] = useState([]);
  const [history, setHistory] = useState([]);
  const [showPanel, setShowPanel] = useState(null);
  const [voices, setVoices] = useState({});

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recognitionRef = useRef(null);

  const currentSeg = segments[currentIdx];

  const speechSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  useEffect(() => {
    fetch("/toeic_content.json")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load content");
        return r.json();
      })
      .then((json) => setData(json))
      .catch((e) => setDataError(e.message));
  }, []);

  useEffect(() => {
    try {
      const r = localStorage.getItem("toeic_review");
      if (r) setReviewList(JSON.parse(r));
    } catch (e) {}
    try {
      const h = localStorage.getItem("toeic_history");
      if (h) setHistory(JSON.parse(h));
    } catch (e) {}
  }, []);

  useEffect(() => {
    const load = () => setVoices(pickVoices());
    load();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = load;
    }
  }, []);

  const saveReview = (list) => {
    setReviewList(list);
    try {
      localStorage.setItem("toeic_review", JSON.stringify(list));
    } catch (e) {}
  };
  const saveHistory = (list) => {
    setHistory(list);
    try {
      localStorage.setItem("toeic_history", JSON.stringify(list));
    } catch (e) {}
  };

  const startSession = () => {
    if (!data) return;
    const { segments: segs, context } = buildSession(data, part, difficulty, part2Mode);
    if (segs.length === 0) {
      alert("問題が見つかりませんでした");
      return;
    }
    setSegments(segs);
    setSessionContext(context);
    setCurrentIdx(0);
    setHyp("");
    setChecked(false);
    setRecordedUrl(null);
    setPhase("practice");
  };

  const backToSetup = () => {
    stopAll();
    setPhase("setup");
  };

  const playSegment = () => {
    if (!currentSeg) return;
    stopAll();
    const u = new SpeechSynthesisUtterance(currentSeg.text);
    u.rate = speed;
    u.lang = "en-US";
    const v = voices[currentSeg.speaker] || voices.narrator;
    if (v) u.voice = v;
    u.onstart = () => setTtsSpeaking(true);
    u.onend = () => setTtsSpeaking(false);
    u.onerror = () => setTtsSpeaking(false);
    window.speechSynthesis.speak(u);
  };

  const stopAll = () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setTtsSpeaking(false);
    stopRecording();
    stopSpeechRecognition();
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setRecordedUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setIsRecording(true);
    } catch (e) {
      alert("マイクへのアクセスが拒否されました");
    }
  };
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };
  const startSpeechRecognition = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("このブラウザは音声認識に対応していません");
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    let final = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t + " ";
        else interim += t;
      }
      setHyp((final + interim).trim());
    };
    rec.onend = () => setIsRecording(false);
    rec.onerror = () => setIsRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setIsRecording(true);
  };
  const stopSpeechRecognition = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
  };
  const toggleMic = () => {
    if (isRecording) {
      if (inputMode === "speech") stopSpeechRecognition();
      else stopRecording();
    } else {
      if (inputMode === "speech") startSpeechRecognition();
      else startRecording();
    }
  };

  const runCheck = () => {
    if (!hyp.trim()) {
      alert("再現を入力または録音してから答え合わせしてください");
      return;
    }
    setChecked(true);
    const r = compareContent(currentSeg.text, hyp);
    saveHistory(
      [
        {
          date: new Date().toISOString(),
          accuracy: r.score,
          part,
          ref: currentSeg.text,
          hyp,
        },
        ...history,
      ].slice(0, 200)
    );
  };

  const nextSeg = () => {
    if (currentIdx < segments.length - 1) {
      stopAll();
      setCurrentIdx(currentIdx + 1);
      setHyp("");
      setChecked(false);
      setRecordedUrl(null);
    }
  };
  const prevSeg = () => {
    if (currentIdx > 0) {
      stopAll();
      setCurrentIdx(currentIdx - 1);
      setHyp("");
      setChecked(false);
      setRecordedUrl(null);
    }
  };
  const retryCurrent = () => {
    stopAll();
    setHyp("");
    setChecked(false);
    setRecordedUrl(null);
  };
  const saveToReview = () => {
    if (!currentSeg) return;
    saveReview([
      {
        text: currentSeg.text,
        part,
        speaker: currentSeg.speaker,
        note: currentSeg.note,
        date: new Date().toISOString(),
        lastScore: checked ? compareContent(currentSeg.text, hyp).score : null,
      },
      ...reviewList,
    ]);
  };
  const removeReview = (i) => {
    const copy = [...reviewList];
    copy.splice(i, 1);
    saveReview(copy);
  };

  const result = checked ? compareContent(currentSeg.text, hyp) : null;

  const partLabel = (p) =>
    ({ 1: "Part 1 · 写真描写", 2: "Part 2 · 応答問題", 3: "Part 3 · 会話", 4: "Part 4 · 説明文" }[
      p
    ] || `Part ${p}`);

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: "#F5F2EC",
        color: "#1E1B18",
        fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        .display { font-family: 'Fraunces', Georgia, serif; letter-spacing: -0.02em; }
        .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
        .chip { display:inline-flex; align-items:center; gap:6px; padding: 6px 10px; border-radius: 999px; border:1px solid #1E1B1820; background:#FBF9F4; font-size:12px; }
        .btn { display:inline-flex; align-items:center; gap:6px; padding: 8px 14px; border-radius: 8px; border:1px solid #1E1B1820; background:#FBF9F4; font-size:13px; font-weight:500; transition: all .15s; cursor:pointer; }
        .btn:hover:not(:disabled) { background:#1E1B18; color:#F5F2EC; }
        .btn-primary { background:#1E1B18; color:#F5F2EC; }
        .btn-primary:hover:not(:disabled) { background:#3d3833; color:#F5F2EC; }
        .btn-danger { background:#7A2A1E; color:#F5F2EC; border-color: #7A2A1E; }
        .btn-danger:hover:not(:disabled) { background:#5a1e15; color:#F5F2EC; }
        .btn:disabled { opacity:.4; cursor:not-allowed; }
        textarea, input, select { font-family: inherit; }
        .word-match { background:#D4E4D8; color:#2D5F3F; padding: 2px 8px; border-radius: 4px; margin: 2px; display:inline-block; }
        .word-missing { background:#F0DDD8; color:#7A2A1E; padding: 2px 8px; border-radius: 4px; margin: 2px; display:inline-block; border: 1px dashed #7A2A1E60; }
        .pulse { animation: pulse 1s infinite; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        .part-btn { flex: 1; padding: 12px 8px; border-radius: 8px; border: 1px solid #1E1B1820; background: #FBF9F4; text-align: center; cursor: pointer; font-size: 12px; transition: all .15s; }
        .part-btn:hover { background: #EFEBE2; }
        .part-btn.active { background: #1E1B18; color: #F5F2EC; }
        .part-btn .num { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 600; display:block; }
      `}</style>

      <header className="max-w-4xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-baseline justify-between flex-wrap gap-4">
          <div>
            <div className="mono text-xs uppercase tracking-widest" style={{ color: "#7a736a" }}>
              TOEIC · Retention · Trainer
            </div>
            <h1 className="display text-4xl md:text-5xl mt-2 font-semibold">Retention</h1>
            <p className="mt-2 text-sm" style={{ color: "#5a544d" }}>
              Hear it once. Hold it. Say it back.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={() => setShowPanel(showPanel === "review" ? null : "review")}>
              <BookmarkPlus size={14} /> 復習 ({reviewList.length})
            </button>
            <button className="btn" onClick={() => setShowPanel(showPanel === "history" ? null : "history")}>
              <History size={14} /> 履歴 ({history.length})
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 pb-24">
        {dataError && (
          <div className="p-4 rounded-lg mb-4" style={{ background: "#F0DDD8", color: "#7A2A1E" }}>
            問題データの読み込みに失敗しました: {dataError}
          </div>
        )}
        {!data && !dataError && (
          <div className="flex items-center gap-2 text-sm" style={{ color: "#7a736a" }}>
            <Loader2 size={14} className="animate-spin" /> 問題データを読み込み中...
          </div>
        )}

        {data && phase === "setup" && (
          <div className="space-y-6">
            <div>
              <label className="mono text-xs uppercase tracking-widest block mb-3" style={{ color: "#7a736a" }}>
                パート選択
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((p) => (
                  <button key={p} className={`part-btn ${part === p ? "active" : ""}`} onClick={() => setPart(p)}>
                    <span className="num">{p}</span>
                    <span>{{ 1: "写真描写", 2: "応答問題", 3: "会話", 4: "説明文" }[p]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mono text-xs uppercase tracking-widest block mb-3" style={{ color: "#7a736a" }}>
                難易度
              </label>
              <div className="flex gap-2">
                {[["easy", "Easy", "初中級"], ["medium", "Medium", "TOEIC 600-800"], ["hard", "Hard", "TOEIC 800+"]].map(([val, label, sub]) => (
                  <button key={val} className={`part-btn ${difficulty === val ? "active" : ""}`} onClick={() => setDifficulty(val)}>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 2 }}>{label}</span>
                    <span style={{ fontSize: 11 }}>{sub}</span>
                  </button>
                ))}
              </div>
            </div>

            {part === 2 && (
              <div>
                <label className="mono text-xs uppercase tracking-widest block mb-3" style={{ color: "#7a736a" }}>
                  Part 2 モード
                </label>
                <div className="flex gap-2">
                  <button className={part2Mode === "question" ? "btn btn-primary" : "btn"} onClick={() => setPart2Mode("question")}>質問文のみ</button>
                  <button className={part2Mode === "both" ? "btn btn-primary" : "btn"} onClick={() => setPart2Mode("both")}>質問+応答セット</button>
                </div>
              </div>
            )}

            <div className="pt-2">
              <button className="btn btn-primary" onClick={startSession}>
                <Shuffle size={14} /> ランダムに問題を出題
              </button>
              <p className="text-xs mt-3" style={{ color: "#7a736a" }}>
                {part <= 2 ? "5問がランダムに選ばれます。" : "1本の" + (part === 3 ? "会話" : "説明文") + "が丸ごと出題されます。"}
              </p>
            </div>
          </div>
        )}

        {data && phase === "practice" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-3">
              <button className="btn" onClick={backToSetup}><ChevronLeft size={14} /> 設定</button>
              <div className="mono text-xs" style={{ color: "#7a736a" }}>
                {partLabel(part)} · {currentIdx + 1} / {segments.length}
              </div>
              <button className="btn" onClick={startSession}><Shuffle size={14} /> 別の問題</button>
            </div>

            {sessionContext && (
              <div className="p-3 rounded-lg text-xs italic" style={{ background: "#EFEBE2", color: "#5a544d" }}>
                Scene: {sessionContext}
              </div>
            )}

            <div className="p-8 rounded-lg text-center" style={{ background: "#FBF9F4", border: "1px solid #1E1B1820", minHeight: 200 }}>
              {!checked ? (
                <div>
                  <div className="mono text-xs uppercase tracking-widest mb-6" style={{ color: "#7a736a" }}>
                    {currentSeg.speaker && currentSeg.speaker !== "narrator" ? `Speaker: ${currentSeg.speaker}` : "Listen · Hold · Reproduce"}
                    {currentSeg.label && ` · ${currentSeg.label}`}
                  </div>
                  <button className="btn btn-primary" onClick={playSegment}>
                    {ttsSpeaking ? (<><Volume2 size={16} className="pulse" /> 再生中...</>) : (<><Play size={16} /> 音声を再生</>)}
                  </button>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <span className="chip">
                      <Gauge size={12} />
                      <select className="bg-transparent outline-none" value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))}>
                        {[0.5, 0.65, 0.75, 0.85, 0.9, 1, 1.15, 1.25, 1.5].map((s) => (<option key={s} value={s}>{s}x</option>))}
                      </select>
                    </span>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mono text-xs uppercase tracking-widest mb-3" style={{ color: "#7a736a" }}>
                    正解{currentSeg.speaker && currentSeg.speaker !== "narrator" ? ` · ${currentSeg.speaker}` : ""}
                  </div>
                  <div className="display text-2xl md:text-3xl font-semibold leading-snug">{currentSeg.text}</div>
                  {currentSeg.note && (<div className="text-sm mt-4 italic" style={{ color: "#5a544d" }}>{currentSeg.note}</div>)}
                </div>
              )}
            </div>

            {!checked && (
              <div>
                <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                  <label className="mono text-xs uppercase tracking-widest" style={{ color: "#7a736a" }}>再現</label>
                  <div className="flex gap-2 flex-wrap">
                    <button className={inputMode === "keyboard" ? "btn btn-primary" : "btn"} onClick={() => { setInputMode("keyboard"); stopAll(); }}>
                      <Keyboard size={14} /> 入力
                    </button>
                    <button className={inputMode === "speech" ? "btn btn-primary" : "btn"} onClick={() => { setInputMode("speech"); stopAll(); }} disabled={!speechSupported}>
                      <Mic size={14} /> 音声認識
                    </button>
                    <button className={inputMode === "record" ? "btn btn-primary" : "btn"} onClick={() => { setInputMode("record"); stopAll(); }}>
                      <Mic size={14} /> 録音のみ
                    </button>
                  </div>
                </div>

                {inputMode === "keyboard" && (
                  <textarea className="w-full p-4 rounded-lg outline-none text-base leading-relaxed" style={{ background: "#FBF9F4", border: "1px solid #1E1B1820", minHeight: 100 }} placeholder="聞こえた内容を思い出せる範囲で書いてください" value={hyp} onChange={(e) => setHyp(e.target.value)} />
                )}

                {inputMode === "speech" && (
                  <div>
                    <div className="w-full p-4 rounded-lg text-base leading-relaxed" style={{ background: "#FBF9F4", border: "1px solid #1E1B1820", minHeight: 100 }}>
                      {hyp || (<span style={{ color: "#7a736a" }}>マイクボタンを押して英語で話してください</span>)}
                    </div>
                    <div className="mt-3">
                      <button className={isRecording ? "btn btn-danger" : "btn btn-primary"} onClick={toggleMic}>
                        {isRecording ? (<><Square size={14} /> 停止</>) : (<><Mic size={14} /> 話し始める</>)}
                      </button>
                    </div>
                  </div>
                )}

                {inputMode === "record" && (
                  <div>
                    <div className="w-full p-4 rounded-lg text-sm" style={{ background: "#FBF9F4", border: "1px solid #1E1B1820" }}>
                      <p style={{ color: "#7a736a" }} className="mb-3">録音は聞き返し用です。答え合わせにはキーボードで内容を打ち込んでください。</p>
                      <div className="flex gap-2 items-center flex-wrap">
                        <button className={isRecording ? "btn btn-danger" : "btn btn-primary"} onClick={toggleMic}>
                          {isRecording ? (<><Square size={14} /> 録音停止</>) : (<><Mic size={14} /> 録音開始</>)}
                        </button>
                        {recordedUrl && (<audio src={recordedUrl} controls className="max-w-full" />)}
                      </div>
                    </div>
                    <textarea className="w-full mt-3 p-4 rounded-lg outline-none text-base leading-relaxed" style={{ background: "#FBF9F4", border: "1px solid #1E1B1820", minHeight: 100 }} placeholder="話した内容をキーボードで書き起こしてください" value={hyp} onChange={(e) => setHyp(e.target.value)} />
                  </div>
                )}

                <div className="mt-4 flex gap-2 flex-wrap">
                  <button className="btn btn-primary" onClick={runCheck}><Check size={14} /> 答え合わせ</button>
                  <button className="btn" onClick={playSegment}><Repeat size={14} /> もう一度聞く</button>
                </div>
              </div>
            )}

            {checked && result && (
              <div className="space-y-4">
                <div className="p-6 rounded-lg" style={{ background: "#FBF9F4", border: "1px solid #1E1B1820" }}>
                  <div className="flex items-baseline gap-3 mb-4">
                    <span className="display text-5xl font-semibold" style={{ color: result.score >= 70 ? "#2D5F3F" : "#1E1B18" }}>{result.score}%</span>
                    <span className="text-sm" style={{ color: "#5a544d" }}>内容語の一致度</span>
                  </div>
                  <div className="mb-4">
                    <div className="mono text-xs uppercase tracking-widest mb-2" style={{ color: "#7a736a" }}>あなたの再現</div>
                    <div className="text-sm p-3 rounded" style={{ background: "#EFEBE2" }}>{hyp}</div>
                  </div>
                  <div>
                    <div className="mono text-xs uppercase tracking-widest mb-2" style={{ color: "#7a736a" }}>内容語チェック</div>
                    <div>
                      {result.matched.map((w, i) => (<span key={"m" + i} className="word-match">{w}</span>))}
                      {result.missing.map((w, i) => (<span key={"x" + i} className="word-missing">{w}</span>))}
                    </div>
                    <div className="mt-4 pt-3 text-xs flex gap-4 flex-wrap" style={{ borderTop: "1px solid #1E1B1820", color: "#7a736a" }}>
                      <span><span className="word-match">言えた</span></span>
                      <span><span className="word-missing">言えなかった</span></span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {currentIdx < segments.length - 1 && (<button className="btn btn-primary" onClick={nextSeg}>次へ <ChevronRight size={14} /></button>)}
                  <button className="btn" onClick={retryCurrent}><RotateCcw size={14} /> もう一度</button>
                  <button className="btn" onClick={saveToReview}><BookmarkPlus size={14} /> 復習に保存</button>
                  {currentIdx > 0 && (<button className="btn" onClick={prevSeg}><ChevronLeft size={14} /> 前へ</button>)}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {showPanel && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "#1E1B1840" }} onClick={() => setShowPanel(null)}>
          <div className="w-full max-w-md h-full overflow-y-auto p-6" style={{ background: "#F5F2EC" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="display text-2xl font-semibold">{showPanel === "review" ? "復習リスト" : "スコア履歴"}</h2>
              <button className="btn" onClick={() => setShowPanel(null)}><X size={14} /></button>
            </div>

            {showPanel === "review" && (
              <div className="space-y-3">
                {reviewList.length === 0 && (<p className="text-sm" style={{ color: "#7a736a" }}>まだ登録されていません。</p>)}
                {reviewList.map((item, i) => (
                  <div key={i} className="p-3 rounded-lg flex justify-between items-start gap-2" style={{ background: "#FBF9F4", border: "1px solid #1E1B1820" }}>
                    <div className="flex-1 min-w-0">
                      <div className="mono text-xs mb-1" style={{ color: "#7a736a" }}>
                        Part {item.part}{item.speaker && item.speaker !== "narrator" ? ` · ${item.speaker}` : ""}
                      </div>
                      <div className="display text-base leading-snug">{item.text}</div>
                      {item.lastScore != null && (<div className="mono text-xs mt-1" style={{ color: "#7a736a" }}>前回: {item.lastScore}%</div>)}
                    </div>
                    <button onClick={() => removeReview(i)} style={{ color: "#7a736a" }}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            {showPanel === "history" && (
              <div className="space-y-3">
                {history.length === 0 && (<p className="text-sm" style={{ color: "#7a736a" }}>履歴はまだありません。</p>)}
                {history.map((h, i) => (
                  <div key={i} className="p-3 rounded-lg" style={{ background: "#FBF9F4", border: "1px solid #1E1B1820" }}>
                    <div className="flex justify-between items-baseline">
                      <span className="display text-2xl font-semibold" style={{ color: h.accuracy >= 70 ? "#2D5F3F" : "#1E1B18" }}>{h.accuracy}%</span>
                      <span className="mono text-xs" style={{ color: "#7a736a" }}>Part {h.part} · {new Date(h.date).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="text-xs mt-1 leading-snug" style={{ color: "#5a544d" }}>{h.ref}</div>
                  </div>
                ))}
                {history.length > 0 && (<button className="btn w-full mt-4" onClick={() => saveHistory([])}>履歴をクリア</button>)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
