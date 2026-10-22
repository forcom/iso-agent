export const APP_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>iso-agent</title>
  <style>
    :root {
      --bg: #f6f3ee;
      --ink: #1c1a17;
      --muted: #5c574e;
      --accent: #0f5c4c;
      --card: #fffdf8;
      --line: #d9d2c5;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "IBM Plex Sans KR", "Pretendard", system-ui, sans-serif;
      background:
        radial-gradient(1200px 600px at 10% -10%, #e7efe9, transparent),
        linear-gradient(180deg, #fbf8f2, var(--bg));
      color: var(--ink);
      min-height: 100vh;
    }
    header {
      display: flex; gap: 1rem; align-items: center; justify-content: space-between;
      padding: 1rem 1.5rem; border-bottom: 1px solid var(--line);
      background: rgba(255,253,248,.85); backdrop-filter: blur(8px);
      position: sticky; top: 0; z-index: 2;
    }
    h1 { font-size: 1.1rem; margin: 0; letter-spacing: -.02em; }
    h1 span { color: var(--accent); }
    main { max-width: 1100px; margin: 0 auto; padding: 1.25rem 1.5rem 3rem; }
    .row { display: flex; gap: .75rem; flex-wrap: wrap; align-items: center; }
    select, button, textarea, input {
      font: inherit; border: 1px solid var(--line); border-radius: 8px;
      padding: .45rem .7rem; background: var(--card); color: var(--ink);
    }
    button {
      background: var(--accent); color: #f4fffb; border-color: transparent; cursor: pointer;
    }
    button.secondary { background: var(--card); color: var(--ink); border-color: var(--line); }
    button:disabled { opacity: .5; cursor: not-allowed; }
    nav { display: flex; gap: .5rem; flex-wrap: wrap; margin: 1rem 0 1.25rem; }
    nav button.active { outline: 2px solid #9ad7c7; }
    section.panel {
      display: none; background: var(--card); border: 1px solid var(--line);
      border-radius: 14px; padding: 1rem 1.1rem; box-shadow: 0 10px 30px rgba(40,30,10,.04);
    }
    section.panel.active { display: block; }
    .muted { color: var(--muted); font-size: .9rem; }
    table { width: 100%; border-collapse: collapse; font-size: .92rem; }
    th, td { text-align: left; padding: .45rem .35rem; border-bottom: 1px solid var(--line); vertical-align: top; }
    pre, .mono {
      font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: .82rem;
      white-space: pre-wrap; word-break: break-word;
    }
    textarea { width: 100%; min-height: 180px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 800px) { .grid2 { grid-template-columns: 1fr; } }
    .pill {
      display: inline-block; padding: .1rem .45rem; border-radius: 999px;
      background: #e8f4ef; color: var(--accent); font-size: .75rem;
    }
    .err { color: #9b1c1c; }
    a { color: var(--accent); }
  </style>
</head>
<body>
  <header>
    <h1><span>iso-agent</span> · AIMS LLM Wiki Ontology</h1>
    <div class="row">
      <label class="muted">사용자</label>
      <select id="person"></select>
      <button id="loginBtn">선택</button>
      <span id="who" class="muted"></span>
    </div>
  </header>
  <main>
    <p class="muted">비밀번호 없는 데모 접속입니다. 권한은 온톨로지 <code>holds_role</code>/<code>grants</code>로 검사합니다.</p>
    <nav>
      <button data-tab="docs" class="active secondary">문서</button>
      <button data-tab="records" class="secondary">기록</button>
      <button data-tab="facts" class="secondary">Fact</button>
      <button data-tab="seed" class="secondary">시드</button>
      <button data-tab="query" class="secondary">질의</button>
      <button data-tab="impact" class="secondary">영향평가 초안</button>
      <button data-tab="wiki" class="secondary">위키</button>
    </nav>

    <section class="panel active" id="tab-docs">
      <div class="row" style="margin-bottom:.75rem">
        <button id="scanDocs">문서 스캔</button>
        <span class="muted">docs/manual·procedure·guide·forms</span>
      </div>
      <div id="docsList"></div>
    </section>

    <section class="panel" id="tab-records">
      <div class="row" style="margin-bottom:.75rem">
        <button id="scanRecords">기록 스캔·자동 fact화</button>
        <span class="muted">records/ → auto_approved facts</span>
      </div>
      <div id="recordsList"></div>
    </section>

    <section class="panel" id="tab-facts">
      <div class="row" style="margin-bottom:.75rem">
        <select id="factFilter">
          <option value="">전체</option>
          <option value="draft">draft</option>
          <option value="approved">approved</option>
          <option value="auto_approved">auto_approved</option>
        </select>
        <button class="secondary" id="reloadFacts">새로고침</button>
      </div>
      <div id="factsList"></div>
    </section>

    <section class="panel" id="tab-seed">
      <p class="muted">시드 JSON을 붙여넣거나 dry-run 후 적용합니다. 예시: <code>seed/example-persons-roles.json</code></p>
      <label><input type="checkbox" id="dryRun" checked /> dry-run</label>
      <label><input type="checkbox" id="overwrite" /> overwrite</label>
      <textarea id="seedJson" placeholder='{"meta":{"ontology_revision":"0.1.0"},"entities":[],"facts":[]}'></textarea>
      <div class="row" style="margin-top:.75rem">
        <button id="importSeed">Import</button>
        <button class="secondary" id="loadExample">예시 시드 로드</button>
      </div>
      <pre id="seedOut" class="mono"></pre>
    </section>

    <section class="panel" id="tab-query">
      <div class="grid2">
        <div>
          <h3>구조 질의</h3>
          <div class="row">
            <select id="qType">
              <option value="trace">요구사항 추적</option>
              <option value="evidence">증거 후보</option>
              <option value="missing">미확인 증거</option>
              <option value="impact">영향 집합</option>
            </select>
            <input id="qId" placeholder="req:42001-6.1.4 또는 aisystem:edu-score" style="min-width:240px" />
            <button id="runGraph">실행</button>
          </div>
          <pre id="graphOut" class="mono"></pre>
        </div>
        <div>
          <h3>자연어 Q&amp;A</h3>
          <textarea id="askText" placeholder="이 요구사항과 연결된 매뉴얼·절차·기록은?"></textarea>
          <button id="askBtn" style="margin-top:.5rem">질문</button>
          <pre id="askOut" class="mono"></pre>
        </div>
      </div>
    </section>

    <section class="panel" id="tab-impact">
      <p class="muted">Edu Score 변경 명세 → impact_set + 영향평가 초안 (양식 자동완성·records 확정 없음)</p>
      <textarea id="changeSpec" placeholder="예: Edu Score에 AI 작성 확률 임계값 자동 에스컬레이션 기능 추가, 배포 예정 2026-11"></textarea>
      <button id="impactBtn" style="margin-top:.5rem">초안 생성</button>
      <pre id="impactOut" class="mono"></pre>
    </section>

    <section class="panel" id="tab-wiki">
      <div id="wikiList"></div>
    </section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    async function api(path, opts = {}) {
      const res = await fetch(path, {
        headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
        credentials: "same-origin",
        ...opts,
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      if (!res.ok) throw new Error(data.error || data.message || text);
      return data;
    }
    function showTab(name) {
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
      $("tab-" + name).classList.add("active");
      document.querySelector('nav button[data-tab="' + name + '"]').classList.add("active");
    }
    document.querySelectorAll("nav button").forEach((b) => {
      b.onclick = () => showTab(b.dataset.tab);
    });

    async function refreshMe() {
      const me = await api("/api/me");
      $("who").textContent = me.person
        ? (me.person.name + " (" + me.person.id + ")")
        : "미선택";
    }
    async function loadPersons() {
      const data = await api("/api/persons");
      const sel = $("person");
      sel.innerHTML = "";
      for (const p of data.persons) {
        const opt = document.createElement("option");
        opt.value = p.id; opt.textContent = p.name + " · " + p.id;
        sel.appendChild(opt);
      }
    }
    $("loginBtn").onclick = async () => {
      await api("/api/session", { method: "POST", body: JSON.stringify({ person_id: $("person").value }) });
      await refreshMe();
    };

    async function loadDocs() {
      const data = await api("/api/documents");
      $("docsList").innerHTML = "<table><tr><th>ID</th><th>유형</th><th>제목</th><th>경로</th></tr>" +
        data.documents.map((d) => "<tr><td class='mono'>" + d.id + "</td><td>" + d.information_type +
          "</td><td>" + (d.title || "") + "</td><td><a href='/" + d.path + "' target='_blank'>" + d.path + "</a></td></tr>").join("") +
        "</table>";
    }
    async function loadRecords() {
      const data = await api("/api/documents?type=record");
      $("recordsList").innerHTML = "<table><tr><th>ID</th><th>제목</th><th>경로</th></tr>" +
        data.documents.map((d) => "<tr><td class='mono'>" + d.id + "</td><td>" + (d.title || "") +
          "</td><td><a href='/" + d.path + "' target='_blank'>" + d.path + "</a></td></tr>").join("") +
        "</table>";
    }
    async function loadFacts() {
      const st = $("factFilter").value;
      const data = await api("/api/facts" + (st ? ("?status=" + st) : ""));
      $("factsList").innerHTML = "<table><tr><th>상태</th><th>종류</th><th>triple</th><th></th></tr>" +
        data.facts.map((f) => {
          const approve = f.status === "draft"
            ? "<button data-approve='" + f.id + "' class='secondary'>승인</button> <button data-reject='" + f.id + "' class='secondary'>반려</button>"
            : "<span class='pill'>" + f.knowledge_kind + "</span>";
          return "<tr><td>" + f.status + "</td><td>" + f.knowledge_kind + "</td><td class='mono'>" +
            f.subject + " —" + f.predicate + "→ " + f.object + "</td><td>" + approve + "</td></tr>";
        }).join("") + "</table>";
      $("factsList").querySelectorAll("[data-approve]").forEach((b) => {
        b.onclick = async () => { await api("/api/facts/" + b.dataset.approve + "/approve", { method: "POST" }); loadFacts(); };
      });
      $("factsList").querySelectorAll("[data-reject]").forEach((b) => {
        b.onclick = async () => { await api("/api/facts/" + b.dataset.reject + "/reject", { method: "POST" }); loadFacts(); };
      });
    }
    async function loadWiki() {
      const data = await api("/api/wiki");
      $("wikiList").innerHTML = data.pages.map((p) =>
        "<article style='margin-bottom:1rem'><h3>" + p.title + " <span class='pill'>" + p.status +
        "</span></h3><pre class='mono'>" + (p.body_md || "").replace(/</g, "&lt;") + "</pre></article>"
      ).join("") || "<p class='muted'>위키 없음</p>";
    }

    $("scanDocs").onclick = async () => { await api("/api/corpus/scan-docs", { method: "POST" }); await loadDocs(); };
    $("scanRecords").onclick = async () => { await api("/api/corpus/scan-records", { method: "POST" }); await loadRecords(); await loadFacts(); };
    $("reloadFacts").onclick = loadFacts;
    $("factFilter").onchange = loadFacts;
    $("loadExample").onclick = async () => {
      const res = await fetch("/seed/example-persons-roles.json");
      $("seedJson").value = await res.text();
    };
    $("importSeed").onclick = async () => {
      try {
        const seed = JSON.parse($("seedJson").value);
        const data = await api("/api/seed/import", {
          method: "POST",
          body: JSON.stringify({
            seed,
            dry_run: $("dryRun").checked,
            overwrite: $("overwrite").checked,
          }),
        });
        $("seedOut").textContent = JSON.stringify(data, null, 2);
        await loadPersons(); await loadFacts(); await loadWiki();
      } catch (e) { $("seedOut").innerHTML = "<span class='err'>" + e.message + "</span>"; }
    };
    $("runGraph").onclick = async () => {
      try {
        const data = await api("/api/graph/query", {
          method: "POST",
          body: JSON.stringify({ type: $("qType").value, id: $("qId").value }),
        });
        $("graphOut").textContent = JSON.stringify(data, null, 2);
      } catch (e) { $("graphOut").innerHTML = "<span class='err'>" + e.message + "</span>"; }
    };
    $("askBtn").onclick = async () => {
      try {
        const data = await api("/api/ask", { method: "POST", body: JSON.stringify({ question: $("askText").value }) });
        $("askOut").textContent = JSON.stringify(data, null, 2);
      } catch (e) { $("askOut").innerHTML = "<span class='err'>" + e.message + "</span>"; }
    };
    $("impactBtn").onclick = async () => {
      try {
        const data = await api("/api/impact/draft", {
          method: "POST",
          body: JSON.stringify({ change: $("changeSpec").value, system_id: "aisystem:edu-score" }),
        });
        $("impactOut").textContent = JSON.stringify(data, null, 2);
      } catch (e) { $("impactOut").innerHTML = "<span class='err'>" + e.message + "</span>"; }
    };

    (async () => {
      try { await api("/api/bootstrap", { method: "POST" }); } catch (_) {}
      await loadPersons();
      await refreshMe();
      await loadDocs();
      await loadRecords();
      await loadFacts();
      await loadWiki();
    })().catch((e) => alert(e.message));
  </script>
</body>
</html>`;
