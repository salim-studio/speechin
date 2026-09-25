/* speechin — محرك إملاء ذكي محلي 100% (مستوحى من Typeless) */
const $ = (id) => document.getElementById(id);
const els = { mic: $("mic"), icon: $("mic-icon"), status: $("status"), statusText: $("status-text"), raw: $("raw"), clean: $("clean"), inLang: $("in-lang"), outLang: $("out-lang"), targetWrap: $("target-wrap"), tone: $("tone"), autoPolish: $("auto-polish"), timer: $("timer"), stWords: $("st-words"), stWpm: $("st-wpm"), stSaved: $("st-saved"), editBar: $("edit-bar"), hint: $("support-hint") };

let mode = "dictate";
let recognizing = false, rec = null, finalText = "", startTime = 0, timerInt = null;

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  b.classList.add("active"); mode = b.dataset.mode;
  els.targetWrap.classList.toggle("hidden", mode !== "translate");
  els.editBar.classList.toggle("hidden", mode !== "edit");
  setStatus(mode === "translate" ? "وضع الترجمة: تحدث وسيُترجم تلقائياً" : mode === "edit" ? "وضع التحرير: حدد نصاً واختر أمراً" : "جاهز — اضغط الميكروفون وابدأ الكلام");
}));

// ---------- Support check ----------
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const secure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.protocol === "file:";
  if (!SR) els.hint.textContent = "⚠️ متصفحك لا يدعم التعرف الصوتي — استخدم Chrome أو Edge. يمكنك الكتابة يدوياً في مربع النص ثم (إعادة تنقيح).";
  else if (!secure && location.protocol !== "file:") els.hint.textContent = "⚠️ الميكروفون يحتاج https أو localhost ليعمل.";
  else els.hint.textContent = "";
})();

function setStatus(t, live = false) { els.statusText.textContent = t; els.status.classList.toggle("live", live); }

// ---------- Timer / stats ----------
function fmt(s) { return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
function tickStats() {
  const words = (els.clean.innerText.trim().match(/\S+/g) || []).length;
  const secs = Math.max(1, Math.round((Date.now() - startTime) / 1000));
  const wpm = Math.round(words / (secs / 60));
  els.stWords.textContent = words + " كلمة";
  els.stWpm.textContent = (isFinite(wpm) ? wpm : 0) + " wpm";
  els.stSaved.textContent = "وفّرت " + Math.max(0, Math.round(words / 45 - words / 220)) + " د";
}
setInterval(() => { if (recognizing) { els.timer.textContent = fmt(Math.round((Date.now() - startTime) / 1000)); tickStats(); } }, 500);

// ================= POLISH ENGINE (محلي) =================
const FILLER = /\b(um+|uh+|er+|ah+|you know|like basically|basically|actually ya3ni|i mean uh)\b|\b(يعني|اه+|امم+|مم+|اا+ه?|ها+|بصراحه|بصراحة|تمام\؟?|اوكيه?|حسنا يعني)\b/gi;
const SELF_CORRECT = /(لا أقصد|لأ قصدي|قصدي|آسف أقصد|سوري أقصد|sorry i mean|i mean|actually i meant|i meant)/i;

function applyDictionary(text) {
  const d = loadDict();
  for (const { from, to } of d) {
    if (!from) continue;
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try { text = text.replace(new RegExp(esc, "gi"), to); } catch {}
  }
  return text;
}
function dedupe(text) {
  return text.split(/(\s+)/).map((tok, i, arr) => {
    if (/^\s+$/.test(tok) || i === 0) return tok;
    const prev = arr.slice(0, i).reverse().find(t => !/^\s+$/.test(t));
    if (prev && tok.localeCompare(prev, undefined, { sensitivity: "base" }) === 0) return "";
    return tok;
  }).join("").replace(/ {2,}/g, " ");
}
function keepLastIntent(text) {
  const m = text.match(new RegExp(`^(.*)(${SELF_CORRECT.source})(.*)$`, "i"));
  if (m) return m[3].trim() || text; // احتفظ بالقصد الأخير فقط
  return text;
}
function formatLists(text) {
  let t = " " + text + " ";
  const map = [["أولا", "1."], ["ثانيا", "2."], ["ثالثا", "3."], ["رابعا", "4."], ["خامسا", "5."], ["first,", "1."], ["second,", "2."], ["third,", "3."], ["next,", "•"], ["finally,", "•"], ["نقطة", "•"], ["نقطه", "•"]];
  for (const [a, b] of map) t = t.replace(new RegExp("\\b" + a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), "\n" + b);
  // جمل طويلة منفصلة بـ "وبعدين / ثم / بعد كده" → سطور
  t = t.replace(/\s+(ثم|وبعدين|بعد كده|كمان)\s+/g, "\n• ");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}
const TONE_MAP_FORMAL = [["عايز", "أرغب"], ["عاوز", "أرغب"], ["عشان", "من أجل"], ["كده", "بهذا الشكل"], ["تمام", "حسناً"], ["ازيك", "تحياتي"], ["hey", "Hello"], ["hi ", "Hello "], ["wanna", "want to"], ["gonna", "going to"], ["thanks", "Thank you"], ["yeah", "yes"]];
function applyTone(text, tone) {
  const isAr = /[\u0600-\u06FF]/.test(text);
  if (tone === "formal") for (const [a, b] of TONE_MAP_FORMAL) text = text.replace(new RegExp("\\b" + a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), b);
  if (tone === "friendly" && isAr) text = text.replace(/^[.\s]*/, "").replace(/^/, "");
  if (tone === "concise") {
    const s = text.split(/(?<=[.!?؟۔])\s+/);
    if (s.length > 2) text = s.filter((_, i) => i % 2 === 0 || i === s.length - 1).join(" ");
    text = text.replace(/\b(جدا جدا|very very|really really)\b/gi, "جداً");
  }
  if (tone === "bullets") {
    const s = text.split(/(?<=[.!?؟۔])\s+|\n+/).map(x => x.trim()).filter(Boolean);
    if (s.length) text = s.map(x => "• " + x.replace(/^[•\-.\d) ]+/, "")).join("\n");
  }
  if (tone === "email") {
    const first = text.slice(0, 60).split(/(?<=[.!?؟])\s*/)[0] || "متابعة";
    text = isAr ? `الموضوع: ${first}\n\nتحية طيبة وبعد،\n\n${text}\n\nمع خالص التقدير` : `Subject: ${first}\n\nHi,\n\n${text}\n\nBest regards`;
  }
  return text;
}
function punctuate(text) {
  text = text.trim().replace(/\s+([,.!?؟،؛:])/g, "$1").replace(/ {2,}/g, " ");
  if (!text) return text;
  const isLatin = /[a-zA-Z]/.test(text[0]);
  if (isLatin) text = text[0].toUpperCase() + text.slice(1);
  const q = /^(هل|لماذا|ليه|ازاي|كيف|متى|امتى|ماذا|ايه|why|what|how|when|where|who|which|can you|could you)/i.test(text);
  if (!/[.!?؟…]$/.test(text)) text += q ? ( /[\u0600-\u06FF]/.test(text) ? "؟" : "?") : ".";
  return text;
}
function polish(rawText) {
  let t = " " + (rawText || "") + " ";
  t = t.replace(FILLER, " ");
  t = keepLastIntent(t);
  t = dedupe(t);
  t = applyDictionary(t);
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return "";
  t = formatLists(t);
  if (els.autoPolish?.checked) t = applyTone(t, els.tone.value === "auto" ? "auto" : els.tone.value);
  else t = applyTone(t, els.tone.value === "bullets" || els.tone.value === "email" ? els.tone.value : "auto");
  // تنقيح الفقرات سطراً بسطر
  t = t.split("\n").map(line => {
    line = line.trim(); if (!line) return "";
    if (/^[•1-9]/.test(line)) { const sym = line.match(/^[•\-]|\d+\./)[0]; return sym + " " + punctuate(line.replace(/^[•\-]|\d+\./, "").trim()); }
    return punctuate(line);
  }).join("\n").replace(/\n{3,}/g, "\n\n");
  return t;
}

// ================= SPEECH RECOGNITION =================
function getRec() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = els.inLang.value; r.interimResults = true; r.continuous = true; r.maxAlternatives = 1;
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const tr = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += (finalText ? " " : "") + tr.trim();
      else interim += tr;
    }
    els.raw.innerText = (finalText + " " + interim).trim();
    const polished = polish(finalText + " " + interim);
    if (mode === "translate") { els.clean.innerText = polished; debounceTranslate(polished); }
    else els.clean.innerText = polished;
    tickStats();
  };
  r.onerror = (e) => { if (e.error === "not-allowed") { setStatus("❌ الميكروفون مرفوض — اسمح من أيقونة القفل في المتصفح"); stopRec(); } };
  r.onend = () => { if (recognizing) { try { r.start(); } catch {} } }; // إعادة تشغيل تلقائية
  return r;
}
function startRec() {
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) { alert("متصفحك لا يدعم التعرف الصوتي. استخدم Chrome/Edge، أو اكتب يدوياً ثم اضغط إعادة تنقيح."); return; }
  finalText = els.raw.innerText.trim() || finalText;
  rec = getRec(); if (!rec) return;
  recognizing = true; startTime = Date.now();
  try { rec.start(); } catch {}
  els.mic.classList.add("rec"); els.icon.textContent = "⏹️";
  setStatus("🔴 يسجل الآن... تحدث طبيعياً", true);
  clearInterval(timerInt);
  timerInt = setInterval(() => { els.timer.textContent = fmt(Math.round((Date.now() - startTime) / 1000)); }, 500);
}
function stopRec() {
  recognizing = false;
  try { rec && rec.stop(); } catch {}
  els.mic.classList.remove("rec"); els.icon.textContent = "🎙️";
  setStatus("✅ تم — يمكنك النسخ أو الحفظ أو التحرير");
  tickStats();
  if (finalText.trim()) autoSave();
}
els.mic.addEventListener("click", () => recognizing ? stopRec() : startRec());
els.inLang.addEventListener("change", () => { if (recognizing) { stopRec(); setTimeout(startRec, 300); } });
$("btn-repolish").addEventListener("click", () => {
  const src = els.raw.innerText.trim() || els.clean.innerText.trim();
  els.raw.innerText = src; finalText = src;
  els.clean.innerText = polish(src); tickStats();
});

// ================= TRANSLATE (MyMemory — مجانية بدون مفتاح) =================
let trT = null;
function srcCode() { return (els.inLang.value || "en-US").split("-")[0]; }
function debounceTranslate(text) { clearTimeout(trT); trT = setTimeout(() => doTranslate(text), 800); }
async function doTranslate(text) {
  if (!text.trim()) return;
  const pair = srcCode() + "|" + els.outLang.value;
  els.clean.innerText = text + "\n\n⏳ جارٍ الترجمة...";
  try {
    const r = await fetch("https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text.slice(0, 450)) + "&langpair=" + pair);
    const j = await r.json();
    const out = j?.responseData?.translatedText;
    if (out) { els.clean.innerText = polish(out); tickStats(); }
    else els.clean.innerText = text + "\n\n⚠️ تعذر الترجمة (حد مجاني). النص الأصلي محفوظ بالأعلى.";
  } catch { els.clean.innerText = text + "\n\n⚠️ لا يوجد اتصال للترجمة. النص الأصلي محفوظ."; }
}

// ================= EDIT COMMANDS (محلية) =================
function currentSel() { return (els.clean.innerText || "").trim(); }
function runCmd(cmd, custom = "") {
  let t = currentSel();
  if (!t) { alert("لا يوجد نص للتحرير — سجّل أولاً أو اكتب في المربع."); return; }
  const isAr = /[\u0600-\u06FF]/.test(t);
  if (cmd === "shorter") { const s = t.split(/(?<=[.!?؟])\s+/); t = s.slice(0, Math.max(1, Math.ceil(s.length / 2))).join(" "); }
  if (cmd === "longer") t += isAr ? " وأود أن أضيف أن هذه النقطة مهمة لأنها توضح الفكرة بشكل عملي وتساعد على اتخاذ القرار المناسب." : " To elaborate, this matters because it clarifies the idea in practical terms and helps with next steps.";
  if (cmd === "formal") t = applyTone(t, "formal");
  if (cmd === "friendly") t = isAr ? t.replace(/تحية طيبة وبعد،?/g, "أهلاً! 😊").replace(/مع خالص التقدير/g, "تحياتي 😊") + "" : "Hey! " + t + " 😊";
  if (cmd === "bullets") t = applyTone(t, "bullets");
  if (cmd === "summary") { const s = t.split(/(?<=[.!?؟])\s+/); t = (isAr ? "الخلاصة: " : "Summary: ") + s.slice(0, 2).join(" "); }
  if (cmd === "translate") { doTranslate(t); return; }
  if (cmd === "custom" && custom) {
    if (/اقصر|اختصر|short/i.test(custom)) return runCmd("shorter");
    if (/طول|أطول|long/i.test(custom)) return runCmd("longer");
    if (/رسمي|formal/i.test(custom)) return runCmd("formal");
    if (/ودود|friendly/i.test(custom)) return runCmd("friendly");
    if (/نقاط|bullet/i.test(custom)) return runCmd("bullets");
    if (/لخص|summar/i.test(custom)) return runCmd("summary");
    if (/ترجم|translat/i.test(custom)) return runCmd("translate");
    if (/ايميل|email/i.test(custom)) { els.clean.innerText = applyTone(t, "email"); return; }
    t = applyTone(t, els.tone.value) + (isAr ? `\n\n(نُفذ الأمر: ${custom})` : `\n\n(Command applied: ${custom})`);
  }
  els.clean.innerText = punctuate(t) === t ? t : punctuate(t);
  if (cmd !== "custom") els.clean.innerText = polish(els.clean.innerText);
  tickStats();
}
document.querySelectorAll("[data-cmd]").forEach(b => b.addEventListener("click", () => runCmd(b.dataset.cmd)));
$("btn-custom-cmd").addEventListener("click", () => runCmd("custom", $("custom-cmd").value.trim()));

// ================= ACTIONS =================
$("btn-copy").addEventListener("click", async () => {
  const t = els.clean.innerText.trim(); if (!t) return alert("لا يوجد نص للنسخ");
  try { await navigator.clipboard.writeText(t); setStatus("📋 تم النسخ!"); } catch { const r = document.createRange(); r.selectNodeContents(els.clean); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand("copy"); }
});
$("btn-txt").addEventListener("click", () => {
  const t = els.clean.innerText.trim(); if (!t) return alert("لا يوجد نص للتحميل");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([t], { type: "text/plain;charset=utf-8" })); a.download = "speechin-" + Date.now() + ".txt"; a.click();
});
$("btn-clear").addEventListener("click", () => { els.raw.innerText = ""; els.clean.innerText = ""; finalText = ""; els.timer.textContent = "00:00"; tickStats(); });
$("btn-save").addEventListener("click", () => autoSave(true));
function autoSave(manual = false) {
  const clean = els.clean.innerText.trim(); if (!clean) { if (manual) alert("لا يوجد نص للحفظ"); return; }
  const h = loadHist(); h.unshift({ t: Date.now(), raw: els.raw.innerText.slice(0, 300), clean: clean.slice(0, 2000), mode, tone: els.tone.value });
  localStorage.setItem("speechin_history", JSON.stringify(h.slice(0, 50)));
  renderHist(); if (manual) setStatus("💾 تم الحفظ في السجل");
}

// ================= DICTIONARY =================
function loadDict() { try { return JSON.parse(localStorage.getItem("speechin_dict") || "[]"); } catch { return []; } }
function renderDict() {
  const d = loadDict(); const ul = $("dict-list"); ul.innerHTML = "";
  if (!d.length) ul.innerHTML = "<li>لا توجد كلمات بعد — مثال: سبيتش ان ← speechin</li>";
  d.forEach((e, i) => { const li = document.createElement("li"); li.innerHTML = `<span><b></b> ← <span></span></span>`; li.querySelector("b").textContent = e.to; li.querySelector("span span").textContent = e.from; const del = document.createElement("button"); del.textContent = "✕"; del.title = "حذف"; del.onclick = () => { const a = loadDict(); a.splice(i, 1); localStorage.setItem("speechin_dict", JSON.stringify(a)); renderDict(); }; li.appendChild(del); ul.appendChild(li); });
}
$("dict-add-btn").addEventListener("click", () => {
  const f = $("dict-from").value.trim(), t = $("dict-to").value.trim();
  if (!f || !t) return alert("اكتب الكلمتين");
  const d = loadDict(); d.push({ from: f, to: t }); localStorage.setItem("speechin_dict", JSON.stringify(d));
  $("dict-from").value = ""; $("dict-to").value = ""; renderDict();
});

// ================= HISTORY =================
function loadHist() { try { return JSON.parse(localStorage.getItem("speechin_history") || "[]"); } catch { return []; } }
function renderHist() {
  const h = loadHist(); const ul = $("hist-list"); ul.innerHTML = "";
  if (!h.length) { ul.innerHTML = "<li>لا يوجد سجل بعد — ابدأ التحدث وسيُحفظ تلقائياً</li>"; return; }
  h.forEach((e, i) => {
    const li = document.createElement("li");
    const d = new Date(e.t).toLocaleString("ar");
    li.innerHTML = `<div><div></div><small></small></div>`;
    li.querySelector("div div").textContent = e.clean.slice(0, 90) + (e.clean.length > 90 ? "..." : "");
    li.querySelector("small").textContent = d + " • " + e.mode + " • " + e.tone;
    li.title = "اضغط للاسترجاع";
    li.onclick = () => { els.clean.innerText = e.clean; els.raw.innerText = e.raw || ""; finalText = e.raw || ""; tickStats(); window.scrollTo({ top: 0, behavior: "smooth" }); };
    const del = document.createElement("button"); del.textContent = "✕"; del.onclick = (ev) => { ev.stopPropagation(); const a = loadHist(); a.splice(i, 1); localStorage.setItem("speechin_history", JSON.stringify(a)); renderHist(); };
    li.appendChild(del); ul.appendChild(li);
  });
}
$("hist-clear").addEventListener("click", () => { if (confirm("مسح كل السجل؟")) { localStorage.removeItem("speechin_history"); renderHist(); } });

// ================= DEMO =================
$("cta-demo").addEventListener("click", () => {
  const demo = els.inLang.value.startsWith("ar") ? "يعني امم انا عايز اقول ان الاجتماع كان كويس كويس جدا لا أقصد كان ممتاز اولا ناقشنا الميزانية ثانيا اتفقنا على الخطة الجديدة" : "um uh I wanted to say the meeting was good good actually I mean it was excellent first, we discussed the budget second, we agreed on the new plan";
  els.raw.innerText = demo; finalText = demo;
  els.clean.innerText = polish(demo); tickStats();
  document.getElementById("app").scrollIntoView({ behavior: "smooth" });
});
$("cta-start").addEventListener("click", () => setTimeout(() => els.mic.focus(), 600));
els.clean.addEventListener("input", tickStats);

renderDict(); renderHist();
