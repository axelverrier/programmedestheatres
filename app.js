const RANGE_START = new Date("2025-09-01");
const RANGE_END   = new Date("2026-07-31");
const TOTAL_MS    = RANGE_END - RANGE_START;

const MONTHS_FR = ["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"];

function pct(dateStr) {
  const d = new Date(dateStr);
  const clamped = Math.max(+RANGE_START, Math.min(+RANGE_END, +d));
  return (clamped - RANGE_START) / TOTAL_MS * 100;
}

function fmt(dateStr) {
  const d = new Date(dateStr);
  return `${d.getDate()} ${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`;
}

// Greedy lane packing to avoid overlapping blocks
function assignLanes(plays) {
  const sorted = [...plays].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  const ends = [];
  for (const p of sorted) {
    const s = +new Date(p.startDate);
    let placed = false;
    for (let i = 0; i < ends.length; i++) {
      if (s >= ends[i]) { p._lane = i; ends[i] = +new Date(p.endDate); placed = true; break; }
    }
    if (!placed) { p._lane = ends.length; ends.push(+new Date(p.endDate)); }
  }
  return ends.length || 1;
}

function getMonths() {
  const r = [], d = new Date(RANGE_START); d.setDate(1);
  while (d <= RANGE_END) { r.push(new Date(d)); d.setMonth(d.getMonth() + 1); }
  return r;
}

let theatres = [];
let activeFilters = new Set(); // empty = show all
let activeRegion = "all"; // "all" | "Paris" | "Ile-de-France"
let editorsPick = false;

// ── Data loaders ─────────────────────────────────────────────────────

// Accepts DD/MM/YYYY or YYYY-MM-DD, returns YYYY-MM-DD
function parseToISO(str) {
  str = str.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [d, m, y] = str.split("/");
    return `${y}-${m}-${d}`;
  }
  return str;
}

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, ""); // strip UTF-8 BOM if present
  const [header, ...lines] = text.trim().split("\n");
  const keys = header.split(";").map(s => s.trim());
  return lines
    .filter(l => l.trim())
    .map(l => Object.fromEntries(l.split(";").map((v, i) => [keys[i], v.trim()])));
}

// Builds the tags array for a play directly from CSV fields, no derivation.
function buildTags(row) {
  const tags = [];
  if (row.type)    tags.push({ label: row.type,    color: TYPE_COLORS[row.type]       || "#888" });
  if (row.genre)   tags.push({ label: row.genre,   color: GENRE_COLORS[row.genre]     || "#888" });
  if (row.classic) tags.push({ label: row.classic, color: CLASSIC_COLORS[row.classic] || "#888" });
  return tags;
}

async function loadData() {
  const [theatreText, playsText] = await Promise.all([
    fetch("theatres.csv").then(r => r.text()),
    fetch("data/pieces2025-2026.csv").then(r => r.text()),
  ]);

  const map = new Map();
  for (const row of parseCSV(theatreText)) {
    map.set(row.theatre_id, {
      id:             row.theatre_id,
      name:           row.name,
      arrondissement: +row.arrondissement,
      url:            row.url,
      status:          row.status || "",
      theatreNational: row.status_theatre_national === "true",
      region:         row.region || "Paris",
      plays:          [],
    });
  }

  for (const row of parseCSV(playsText)) {
    const theatre = map.get(row.theatre_id);
    if (!theatre) continue;
    theatre.plays.push({
      title:        row.title,
      author:       row.author,
      director:     row.director,
      choregraphe:  row.choregraphe || "",
      tags:         buildTags(row),
      editorspick:  row.editorspick === "true",
      startDate:    parseToISO(row.start_date),
      endDate:      parseToISO(row.end_date),
      salle:        row.salle || "",
      url:          row.url  || "",
    });
  }

  return [...map.values()];
}

// ── Render ──────────────────────────────────────────────────────────

function render() {
  const wrap = document.getElementById("timeline");
  wrap.innerHTML = "";

  const months = getMonths();
  const today  = new Date();

  // Month header row
  const mRow = document.createElement("div");
  mRow.className = "months-row";
  mRow.innerHTML = '<div></div>';          // spacer for name column

  const mTrack = document.createElement("div");
  mTrack.className = "months-track";

  months.forEach(d => {
    const lbl = document.createElement("div");
    lbl.className = "month-label";
    lbl.style.left = ((d - RANGE_START) / TOTAL_MS * 100) + "%";
    lbl.textContent = MONTHS_FR[d.getMonth()] + " " + String(d.getFullYear()).slice(2);
    mTrack.appendChild(lbl);
  });

  // Today tick in header
  if (today >= RANGE_START && today <= RANGE_END) {
    const tick = document.createElement("div");
    tick.className = "months-today";
    tick.style.left = ((today - RANGE_START) / TOTAL_MS * 100) + "%";
    mTrack.appendChild(tick);
  }

  mRow.appendChild(mTrack);
  wrap.appendChild(mRow);

  // Theatre rows
  const visibleTheatres = (activeRegion === "all"
    ? theatres
    : theatres.filter(t => t.region === activeRegion)
  ).map(t => ({
    ...t,
    plays: editorsPick ? t.plays.filter(p => p.editorspick) : t.plays,
  })).filter(t => t.plays.length > 0);

  visibleTheatres.forEach(theatre => {
    const numLanes  = assignLanes(theatre.plays);
    const trackH    = numLanes * 51 + 8;

    const row = document.createElement("div");
    row.className = "theatre-row";

    // Name column
    const nameDiv = document.createElement("div");
    nameDiv.className = "theatre-name";
    nameDiv.innerHTML =
      `<a href="${theatre.url}" target="_blank" rel="noopener">${theatre.name}</a>` +
      `<span class="arr">${theatre.arrondissement}e arr.</span>` +
      (theatre.theatreNational ? `<span class="status-badge badge-national">Théâtre National</span>` : theatre.status === "public" ? `<span class="status-badge badge-public">Public</span>` : "");
    row.appendChild(nameDiv);

    // Track
    const track = document.createElement("div");
    track.className = "theatre-track";
    track.style.height = trackH + "px";

    // Month grid lines
    months.forEach(d => {
      const line = document.createElement("div");
      line.className = "month-line";
      line.style.left = ((d - RANGE_START) / TOTAL_MS * 100) + "%";
      track.appendChild(line);
    });

    // Today line
    if (today >= RANGE_START && today <= RANGE_END) {
      const tl = document.createElement("div");
      tl.className = "today-line";
      tl.style.left = ((today - RANGE_START) / TOTAL_MS * 100) + "%";
      track.appendChild(tl);
    }

    // Play blocks
    theatre.plays.forEach(play => {
      const left  = pct(play.startDate);
      const right = pct(play.endDate);
      const w     = right - left;
      if (w <= 0) return;

      const isOn = activeFilters.size === 0 || play.tags.some(t => activeFilters.has(t.label));

      const block = document.createElement("div");
      block.className = "play-block" + (isOn ? "" : " dimmed");
      block.style.left   = left + "%";
      block.style.width  = w + "%";
      block.style.top    = (play._lane * 51 + 4) + "px";
      block.style.height = "44px";

      const inner = document.createElement("div");
      inner.className = "play-block-inner";

      const titleEl = (play.url && !isTouch())
        ? Object.assign(document.createElement("a"), {
            href: play.url, target: "_blank", rel: "noopener",
            className: "play-title play-title-link",
          })
        : Object.assign(document.createElement("span"), { className: "play-title" });
      titleEl.textContent = play.title;
      inner.appendChild(titleEl);

      const tagsDiv = document.createElement("div");
      tagsDiv.className = "play-tags";
      play.tags.forEach(t => {
        const tag = document.createElement("span");
        tag.className = "play-tag";
        tag.innerHTML = `<span class="tag-dot" style="background:${t.color}"></span>${t.label}`;
        tagsDiv.appendChild(tag);
      });
      inner.appendChild(tagsDiv);

      block.appendChild(inner);

      if (isOn) {
        if (isTouch()) {
          block.addEventListener("click", e => { e.stopPropagation(); showTip(null, play, theatre.id); });
        } else {
          block.addEventListener("mouseenter", e => showTip(e, play, theatre.id));
          block.addEventListener("mousemove",  moveTip);
          block.addEventListener("mouseleave", hideTip);
        }
      }

      track.appendChild(block);
    });

    row.appendChild(track);
    wrap.appendChild(row);
  });
}

// ── Tooltip ──────────────────────────────────────────────────────────

const tip = document.getElementById("tooltip");
const isTouch = () => window.matchMedia("(pointer: coarse)").matches;

function tipContent(p, theatreId) {
  const typeBadges = p.tags
    .map(t => `<span class="tt-type" style="background:${t.color}">${t.label}</span>`)
    .join(" ");
  return (
    (p.url
      ? `<a class="tt-title tt-title-link" href="${p.url}" target="_blank" rel="noopener">${p.title} ↗</a>`
      : `<div class="tt-title">${p.title}</div>`) +
    `<div class="tt-types">${typeBadges}</div>` +
    (p.salle    ? `<div class="tt-row"><span class="lbl">Salle ·</span> ${p.salle}</div>`             : "") +
    (p.author      ? `<div class="tt-row"><span class="lbl">Auteur ·</span> ${p.author}</div>`             : "") +
    (p.director    ? `<div class="tt-row"><span class="lbl">Mise en scène ·</span> ${p.director}</div>`    : "") +
    (p.choregraphe ? `<div class="tt-row"><span class="lbl">Chorégraphie ·</span> ${p.choregraphe}</div>` : "") +
    `<div class="tt-dates">${fmt(p.startDate)} → ${fmt(p.endDate)}</div>`
  );
}

function showTip(e, p, theatreId) {
  tip.innerHTML = tipContent(p, theatreId);
  tip.classList.remove("tip-fixed");
  if (isTouch()) {
    tip.classList.add("tip-fixed");
  }
  tip.classList.add("visible");
  if (e) moveTip(e);
}

function moveTip(e) {
  if (isTouch()) return;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  // Keep tooltip right of the name column, never off-screen
  const sc      = document.getElementById("scrollContainer");
  const minLeft = sc.getBoundingClientRect().left + getNameWidth() + 8;
  let x = e.clientX + 15, y = e.clientY - 10;
  if (x + tw > window.innerWidth)  x = e.clientX - tw - 15;
  if (y + th > window.innerHeight) y = e.clientY - th + 20;
  x = Math.max(minLeft, x);
  tip.style.left = x + "px";
  tip.style.top  = y + "px";
}

function hideTip() { tip.classList.remove("visible"); }

// Close mobile tooltip on tap outside
document.addEventListener("click", hideTip);

// ── Sticky labels ─────────────────────────────────────────────────────
// When a block's left edge is scrolled off-screen, push its title into view.

function updateLabels() {
  const sc   = document.getElementById("scrollContainer");
  const minX = sc.getBoundingClientRect().left + getNameWidth() + 8;
  document.querySelectorAll(".play-block").forEach(block => {
    const rect  = block.getBoundingClientRect();
    const inner = block.querySelector(".play-block-inner");
    if (rect.left < minX && rect.right > minX) {
      inner.style.transform = `translateX(${minX - rect.left}px)`;
    } else {
      inner.style.transform = "";
    }
  });
}

// ── Mirror scrollbar ─────────────────────────────────────────────────

const sc     = document.getElementById("scrollContainer");
const mirror = document.getElementById("scrollMirror");
const mirrorInner = document.getElementById("scrollMirrorInner");

function syncMirrorWidth() {
  mirrorInner.style.width = sc.scrollWidth + "px";
}

let syncingFromSc = false, syncingFromMirror = false;
let labelRafPending = false;
sc.addEventListener("scroll", () => {
  if (!labelRafPending) {
    labelRafPending = true;
    requestAnimationFrame(() => { updateLabels(); labelRafPending = false; });
  }
  if (syncingFromMirror) return;
  syncingFromSc = true;
  mirror.scrollLeft = sc.scrollLeft;
  syncingFromSc = false;
}, { passive: true });

mirror.addEventListener("scroll", () => {
  if (syncingFromSc) return;
  syncingFromMirror = true;
  sc.scrollLeft = mirror.scrollLeft;
  syncingFromMirror = false;
}, { passive: true });

// ── Filters ──────────────────────────────────────────────────────────

function renderEditorsPick() {
  const btn = document.getElementById("editorsPickBtn");
  btn.classList.toggle("active", editorsPick);
}

function renderRegionFilters() {
  const c = document.getElementById("regionFilters");
  c.innerHTML = "";
  [["all", "Tous"], ["Paris", "Paris"], ["Ile-de-France", "Île-de-France"]].forEach(([val, label]) => {
    const btn = document.createElement("button");
    btn.className = "filter-btn" + (activeRegion === val ? " active" : "");
    btn.style.setProperty("--type-color", "#555");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      activeRegion = val;
      c.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      render();
      syncMirrorWidth();
      updateLabels();
    });
    c.appendChild(btn);
  });
}

function renderFilterGroup(containerId, colorMap) {
  const c = document.getElementById(containerId);
  c.innerHTML = "";
  Object.entries(colorMap).forEach(([label, color]) => {
    const btn = document.createElement("button");
    btn.className = "filter-btn" + (activeFilters.has(label) ? " active" : "");
    btn.style.setProperty("--type-color", color);
    btn.innerHTML = `<span class="dot" style="background:${color}"></span>${label}`;
    btn.addEventListener("click", () => {
      if (activeFilters.has(label)) { activeFilters.delete(label); btn.classList.remove("active"); }
      else                          { activeFilters.add(label);    btn.classList.add("active");    }
      render();
      syncMirrorWidth();
      updateLabels();
    });
    c.appendChild(btn);
  });
}

function renderFilters() { renderFilterGroup("filters", TYPE_COLORS); }

// ── Initial view + Today button ───────────────────────────────────────

function getNameWidth() {
  return parseInt(getComputedStyle(document.documentElement)
    .getPropertyValue("--name-w")) || 220;
}

// Size the timeline so 5 weeks (1 before + 4 after today) fill the viewport,
// then scroll to show 1 week before today on the left edge.
function setInitialView() {
  const sc     = document.getElementById("scrollContainer");
  const wrap   = document.getElementById("timeline");
  const nameW  = getNameWidth();
  const trackViewW = sc.clientWidth - nameW;         // visible track pixels
  const daysVisible = 35;                            // 5 weeks
  const pxPerDay = trackViewW / daysVisible;
  const totalDays  = TOTAL_MS / 864e5;
  const totalTrackW = pxPerDay * totalDays;

  wrap.style.minWidth = (nameW + totalTrackW) + "px";

  const today = new Date();
  const anchor = new Date(today);
  anchor.setDate(anchor.getDate() - 7);              // 1 week before today
  const scrollPct = Math.max(0, (anchor - RANGE_START) / TOTAL_MS);
  sc.scrollLeft = scrollPct * totalTrackW;
}

function scrollToToday() {
  const today = new Date();
  if (today < RANGE_START || today > RANGE_END) return;
  const sc    = document.getElementById("scrollContainer");
  const nameW = getNameWidth();
  const trackW = sc.scrollWidth - nameW;
  const pctToday = (today - RANGE_START) / TOTAL_MS;
  sc.scrollLeft = Math.max(0, pctToday * trackW - (sc.clientWidth - nameW) / 5);
}
document.querySelectorAll(".today-btn").forEach(btn => btn.addEventListener("click", scrollToToday));

document.getElementById("filtersToggle").addEventListener("click", () => {
  const controls = document.getElementById("controls");
  const open = controls.classList.toggle("open");
  document.getElementById("filtersToggle").textContent = open ? "Filtres ▴" : "Filtres ▾";
});

document.getElementById("editorsPickBtn").addEventListener("click", () => {
  editorsPick = !editorsPick;
  renderEditorsPick();
  render();
  syncMirrorWidth();
  updateLabels();
});

// ── Init ─────────────────────────────────────────────────────────────

(async () => {
  try {
    theatres = await loadData();
  } catch (e) {
    document.getElementById("timeline").innerHTML =
      `<p style="padding:24px;color:#c00">Impossible de charger les données.<br>
      Ouvrez le site via un serveur local (ex: <code>python -m http.server</code>).</p>`;
    return;
  }
  renderFilters();
  renderFilterGroup("genreFilters", GENRE_COLORS);
  renderFilterGroup("classicFilters", CLASSIC_COLORS);
  renderRegionFilters();
  renderEditorsPick();
  render();
  setInitialView();
  syncMirrorWidth();
  updateLabels();
})();
