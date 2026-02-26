// ═══════════════════════════════════════════════════════════
// APP.JS — CampBudget Meal Planning Suite
// Modules: Dashboard, Planner, Shared Ingredients, Catalog,
//          Order Sheet, Budget History, Settings, AI Matcher
// ═══════════════════════════════════════════════════════════

// ── SETTINGS & INTEGRATIONS ──────────────────────────────────
const SETTINGS = {
  anthropicKey:   localStorage.getItem('cb_anthropic_key') || '',
  sheetsUrl:      localStorage.getItem('cb_sheets_url') || '',
  driveFolder:    localStorage.getItem('cb_drive_folder') || '',
  eventName:      localStorage.getItem('cb_event_name') || 'Family Immersion Camp',
  eventDates:     localStorage.getItem('cb_event_dates') || 'Jul 17–19, 2026',
  eventGuests:    parseInt(localStorage.getItem('cb_event_guests') || '160'),
  buffer:         parseFloat(localStorage.getItem('cb_buffer') || '0.10'),
  autoSave:       localStorage.getItem('cb_autosave') !== 'false',
  collab_pin:     localStorage.getItem('cb_pin') || '',
  theme:          localStorage.getItem('cb_theme') || 'dark',
};

function saveSetting(key, val) {
  SETTINGS[key] = val;
  localStorage.setItem(`cb_${key}`, val);
}

// ── STATE ─────────────────────────────────────────────────────
let state = {};          // mealId → [{...ingredient}]
let activeMeal = null;
let catalogFilter = '';
let catalogCat = '';
let catalogSortKey = 'description';
let catalogSortDir = 1;
let focusedIngIdx = null;
let activityLog = JSON.parse(localStorage.getItem('cb_activity') || '[]');
let history = JSON.parse(localStorage.getItem('cb_history') || '[]');
let sharedIngredients = JSON.parse(localStorage.getItem('cb_shared') || '[]');
// sharedIngredients = [{name, meals:[{mealId, split%}], totalCost}]

const CATEGORIES = [...new Set(LABATT_CATALOG.map(i => i.category))].sort();

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  buildCatPills();
  buildCatPillsPage();
  renderPlannerTabs();
  renderCatalogSidebar();
  navigate('dashboard');
  if (SETTINGS.autoSave) setInterval(autoSave, 30000);
  updateSidebarTotals();
});

function loadState() {
  const saved = localStorage.getItem('cb_state');
  if (saved) {
    try { state = JSON.parse(saved); return; } catch(e) {}
  }
  // Build fresh from MEALS_DEF
  state = {};
  Object.keys(MEALS_DEF).forEach(mealId => {
    state[mealId] = MEALS_DEF[mealId].ingredients.map(ing => ({
      name: ing.name, unit: ing.unit,
      qtyToBuy: ing.qtyNeeded, unitPrice: 0,
      note: ing.note || '',
      labattId: '', labattName: '', packSize: '',
      isShared: false, sharedId: null,
    }));
    autoMatchMeal(mealId);
  });
  activeMeal = Object.keys(MEALS_DEF)[0];
}

function autoMatchMeal(mealId) {
  state[mealId].forEach((ing, idx) => {
    const words = ing.name.toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/).filter(w=>w.length>3);
    let best = null, bestScore = 0;
    LABATT_CATALOG.forEach(item => {
      const d = item.description.toLowerCase();
      let score = words.reduce((s,w) => s + (d.includes(w)?1:0), 0);
      if (score > bestScore && item.price > 0) { bestScore = score; best = item; }
    });
    if (best && bestScore >= 1) {
      state[mealId][idx].labattId   = best.id;
      state[mealId][idx].labattName = best.description;
      state[mealId][idx].packSize   = best.packSize;
      state[mealId][idx].unitPrice  = best.price;
    }
  });
}

function autoSave() {
  localStorage.setItem('cb_state', JSON.stringify(state));
  localStorage.setItem('cb_shared', JSON.stringify(sharedIngredients));
  localStorage.setItem('cb_activity', JSON.stringify(activityLog.slice(0,50)));
  document.getElementById('saveStatus').textContent = '● Saved ' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}

// ── NAVIGATION ────────────────────────────────────────────────
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById(`page-${page}`);
  if (pg) pg.classList.add('active');
  const nav = document.querySelector(`[data-page="${page}"]`);
  if (nav) nav.classList.add('active');

  // Render page content
  const renders = {
    dashboard: renderDashboard,
    planner: renderPlannerPage,
    shared: renderSharedPage,
    catalog: renderCatalogPage,
    ordersheet: renderOrderSheet,
    history: renderHistoryPage,
    settings: renderSettingsPage,
  };
  if (renders[page]) renders[page]();
  updateSidebarTotals();
}

// ══════════════════════════════════
// DASHBOARD
// ══════════════════════════════════
function renderDashboard() {
  const pg = document.getElementById('page-dashboard');
  const scrollWrap = pg.querySelector('.page-scroll') || (() => {
    const d = document.createElement('div');
    d.className = 'page-scroll';
    pg.appendChild(d);
    return d;
  })();

  const gt = grandTotal();
  const totalItems = Object.values(state).flat().length;
  const pricedItems = Object.values(state).flat().filter(i=>i.unitPrice>0).length;
  const unmatchedCount = Object.values(state).flat().filter(i=>!i.labattId).length;

  // Stats
  document.getElementById('dashStats').innerHTML = [
    { label: 'Grand Total', value: fmt(gt), sub: `+${(SETTINGS.buffer*100).toFixed(0)}% buffer: ${fmt(gt*(1+SETTINGS.buffer))}`, cls: 'stat-accent' },
    { label: 'Cost per Guest', value: fmt(gt/SETTINGS.eventGuests), sub: `${SETTINGS.eventGuests} guests`, cls: '' },
    { label: 'Items Priced', value: `${pricedItems}/${totalItems}`, sub: `${unmatchedCount} need attention`, cls: unmatchedCount > 0 ? 'stat-warn' : '' },
    { label: 'Meals Planned', value: Object.keys(state).length, sub: Object.keys(MEALS_DEF).map(id=>MEALS_DEF[id].icon).join(' '), cls: '' },
  ].map((s,i) => `
    <div class="stat-card" style="animation-delay:${i*0.05}s">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value ${s.cls}">${s.value}</div>
      <div class="stat-sub">${s.sub}</div>
    </div>`).join('');

  // Meals grid
  document.getElementById('dashMealsGrid').innerHTML = Object.entries(MEALS_DEF).map(([id, meal], i) => {
    const items = state[id] || [];
    const priced = items.filter(i=>i.unitPrice>0).length;
    const total = mealTotal(id);
    const pct = items.length ? Math.round(priced/items.length*100) : 0;
    return `<div class="meal-card" style="animation-delay:${i*0.06}s" onclick="navigate('planner');setActiveMeal('${id}')">
      <div class="meal-card-top">
        <div class="meal-card-icon">${meal.icon}</div>
        <div class="meal-progress-wrap">
          <div class="meal-progress-track"><div class="meal-progress-fill" style="width:${pct}%"></div></div>
        </div>
      </div>
      <div class="meal-card-name">${meal.name}</div>
      <div class="meal-card-date">${meal.date}</div>
      <div class="meal-card-total">${fmt(total)}</div>
      <div class="meal-card-items">${priced}/${items.length} items priced · $${(total/SETTINGS.eventGuests).toFixed(2)}/guest</div>
    </div>`;
  }).join('');

  // Alerts
  const alerts = buildAlerts();
  document.getElementById('dashAlerts').innerHTML = alerts.length
    ? alerts.map(a => `<div class="alert-item ${a.type}">
        <div class="alert-icon">${a.icon}</div>
        <div class="alert-text">${a.text}</div>
        ${a.action ? `<div class="alert-action" onclick="${a.action.fn}">${a.action.label}</div>` : ''}
      </div>`).join('')
    : '<div class="alert-item ok"><div class="alert-icon">✅</div><div class="alert-text">Everything looks good! All meals have pricing.</div></div>';

  // Activity
  document.getElementById('dashActivity').innerHTML = activityLog.length
    ? activityLog.slice(0,8).map(a => `
        <div class="activity-item">
          <span>${a.icon}</span>
          <span style="flex:1">${a.text}</span>
          <span class="activity-time">${a.time}</span>
        </div>`).join('')
    : '<div class="activity-item" style="color:var(--text3)">No activity yet — start planning your meals!</div>';
}

function buildAlerts() {
  const alerts = [];
  const unmatched = Object.values(state).flat().filter(i=>!i.labattId).length;
  if (unmatched > 0)
    alerts.push({ type:'warn', icon:'⚠️', text:`${unmatched} ingredients have no Labatt match yet.`, action:{label:'Run AI Match →', fn:"batchAIMatch()"} });
  const unpriced = Object.values(state).flat().filter(i=>i.unitPrice===0).length;
  if (unpriced > 0)
    alerts.push({ type:'warn', icon:'💰', text:`${unpriced} ingredients are missing prices.`, action:{label:'Open Planner →', fn:"navigate('planner')"} });
  if (!SETTINGS.anthropicKey)
    alerts.push({ type:'info', icon:'🤖', text:'Add your Anthropic API key in Settings to enable AI matching.', action:{label:'Settings →', fn:"navigate('settings')"} });
  if (!SETTINGS.sheetsUrl)
    alerts.push({ type:'info', icon:'📊', text:'Connect Google Sheets in Settings to sync prices automatically.', action:{label:'Settings →', fn:"navigate('settings')"} });
  if (history.length === 0)
    alerts.push({ type:'info', icon:'📚', text:'Save this budget to start building your history for year-over-year comparisons.', action:{label:'Save Now →', fn:"saveCurrentBudget()"} });
  return alerts;
}

function logActivity(icon, text) {
  const time = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  activityLog.unshift({ icon, text, time });
  activityLog = activityLog.slice(0, 50);
}

// ══════════════════════════════════
// MEAL PLANNER
// ══════════════════════════════════
function renderPlannerPage() {
  if (!activeMeal) activeMeal = Object.keys(MEALS_DEF)[0];
  renderPlannerTabs();
  renderMealIngredients();
  renderCatalogSidebar();
  updatePlannerSub();
}

function updatePlannerSub() {
  const total = grandTotal();
  const priced = Object.values(state).flat().filter(i=>i.unitPrice>0).length;
  const total_items = Object.values(state).flat().length;
  document.getElementById('plannerSub').textContent = `${Object.keys(MEALS_DEF).length} meals · ${priced}/${total_items} items priced · Grand total: ${fmt(total)}`;
}

function renderPlannerTabs() {
  document.getElementById('mealTabs').innerHTML = Object.entries(MEALS_DEF).map(([id, meal]) => {
    const total = mealTotal(id);
    const items = state[id] || [];
    const pct = items.length ? Math.round(items.filter(i=>i.unitPrice>0).length/items.length*100) : 0;
    return `<div class="meal-tab ${id===activeMeal?'active':''}" onclick="setActiveMeal('${id}')">
      <div class="mt-icon">${meal.icon}</div>
      <div class="mt-name">${meal.name}</div>
      <div class="mt-date">${meal.date}</div>
      <div class="mt-total">${fmt(total)}</div>
      <div class="mt-progress"><div class="mt-progress-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function setActiveMeal(mealId) {
  activeMeal = mealId;
  renderPlannerTabs();
  renderMealIngredients();
  focusedIngIdx = null;
}

function renderMealIngredients() {
  if (!activeMeal) return;
  const meal = MEALS_DEF[activeMeal];
  const items = state[activeMeal] || [];
  const total = mealTotal(activeMeal);
  const priced = items.filter(i=>i.unitPrice>0).length;

  document.getElementById('mealHeaderBar').innerHTML = `
    <div class="mhb-left">
      <h2>${meal.icon} ${meal.name}</h2>
      <p>${meal.date} · ${SETTINGS.eventGuests} guests · ${priced}/${items.length} items priced</p>
    </div>
    <div class="mhb-total">
      <div class="mhb-total-label">Meal Total</div>
      <div class="mhb-total-amt">${fmt(total)}</div>
    </div>`;

  document.getElementById('ingredientList').innerHTML = items.map((ing, idx) => {
    const lineTotal = ing.qtyToBuy * ing.unitPrice;
    const status = ing.labattId ? 'matched' : (findPartialMatches(ing.name).length > 0 ? 'partial' : 'unmatched');
    const sharedCls = ing.isShared ? ' shared-ing' : '';
    return `<div class="ing-row ${status}${sharedCls}" id="ingRow-${idx}" onclick="focusIngredient(${idx})">
      <div class="ing-name-wrap">
        <div class="ing-name">${ing.name}</div>
        <div class="ing-meta">
          <span class="ing-badge ${status}">${status==='matched'?'✓ Matched':status==='partial'?'~ In catalog':'✗ Not found'}</span>
          ${ing.isShared?'<span class="ing-badge shared">shared</span>':''}
          <span class="ing-labatt" title="${ing.labattName||ing.note}">${ing.labattName||ing.note}</span>
        </div>
      </div>
      <input class="ing-input" type="number" value="${ing.qtyToBuy}" min="0" step="0.5"
        onchange="updateField(${idx},'qtyToBuy',parseFloat(this.value)||0)"
        onclick="event.stopPropagation()">
      <input class="ing-input" type="text" value="${ing.unit}"
        onchange="updateField(${idx},'unit',this.value)"
        onclick="event.stopPropagation()">
      <input class="ing-input" type="number" value="${ing.unitPrice||''}" min="0" step="0.01" placeholder="$0.00"
        onchange="updateField(${idx},'unitPrice',parseFloat(this.value)||0)"
        onclick="event.stopPropagation()">
      <div class="ing-total">${lineTotal > 0 ? fmt(lineTotal) : '—'}</div>
      <div class="ing-actions">
        <button class="ing-btn ai" title="AI Match" onclick="event.stopPropagation();openAIModal(${idx})">🤖</button>
        <button class="ing-btn" title="Mark as shared" onclick="event.stopPropagation();toggleShared(${idx})">🔀</button>
        <button class="ing-btn delete" title="Delete" onclick="event.stopPropagation();deleteIngredient(${idx})">×</button>
      </div>
    </div>`;
  }).join('');
}

function focusIngredient(idx) {
  focusedIngIdx = idx;
  document.querySelectorAll('.ing-row').forEach((r,i) => {
    r.style.outline = i===idx ? '1px solid var(--accent)' : '';
  });
}

function updateField(idx, field, value) {
  state[activeMeal][idx][field] = value;
  renderMealIngredients();
  renderPlannerTabs();
  updateSidebarTotals();
  logActivity('✏️', `Updated ${field} for "${state[activeMeal][idx].name}" in ${MEALS_DEF[activeMeal].name}`);
}

function deleteIngredient(idx) {
  const name = state[activeMeal][idx].name;
  state[activeMeal].splice(idx, 1);
  renderMealIngredients();
  renderPlannerTabs();
  updateSidebarTotals();
  logActivity('🗑️', `Removed "${name}" from ${MEALS_DEF[activeMeal].name}`);
}

function addIngredient() {
  state[activeMeal].push({ name:'New ingredient', unit:'case', qtyToBuy:1, unitPrice:0, note:'', labattId:'', labattName:'', packSize:'', isShared:false });
  renderMealIngredients();
  focusIngredient(state[activeMeal].length - 1);
}

function toggleShared(idx) {
  state[activeMeal][idx].isShared = !state[activeMeal][idx].isShared;
  if (state[activeMeal][idx].isShared) {
    const name = state[activeMeal][idx].name;
    const existing = sharedIngredients.find(s=>s.name===name);
    if (!existing) {
      sharedIngredients.push({ id: Date.now(), name, meals:[{mealId:activeMeal, split:100}] });
    }
    logActivity('🔀', `Marked "${name}" as shared`);
  }
  renderMealIngredients();
}

function findPartialMatches(name) {
  const words = name.toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/).filter(w=>w.length>3);
  return LABATT_CATALOG.filter(item => words.some(w => item.description.toLowerCase().includes(w)));
}

// ── CATALOG SIDEBAR ───────────────────────────────────────────
function buildCatPills() {
  document.getElementById('catPills').innerHTML =
    `<button class="cat-pill ${!catalogCat?'active':''}" onclick="setCatalogCat('')">All</button>` +
    CATEGORIES.map(c => `<button class="cat-pill ${catalogCat===c?'active':''}" onclick="setCatalogCat('${c}')">${c}</button>`).join('');
}

function setCatalogCat(cat) {
  catalogCat = cat;
  buildCatPills();
  buildCatPillsPage();
  renderCatalogSidebar();
  renderCatalogPage();
}

function filterCatalog() {
  catalogFilter = document.getElementById('catalogSearch')?.value || '';
  renderCatalogSidebar();
}

function renderCatalogSidebar() {
  const results = filterItems(80);
  document.getElementById('catalogCount').textContent = `${results.length}${results.length===80?'+':''} of 532`;
  document.getElementById('catalogList').innerHTML = results.map(item => {
    const q = catalogFilter;
    const name = q ? item.description.replace(new RegExp(`(${escRe(q)})`, 'gi'), '<span class="ci-highlight">$1</span>') : item.description;
    return `<div class="catalog-item" onclick="assignCatalogItem('${item.id}')">
      <div class="ci-name">${name}</div>
      <div class="ci-bottom">
        <span class="ci-pack">${item.packSize}</span>
        <span class="ci-price ${item.price===0?'noprice':''}">${item.price>0?'$'+item.price.toFixed(2):'No price'}</span>
      </div>
      <span class="ci-label">${item.label} · ${item.id}</span>
    </div>`;
  }).join('') || '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">No results</div>';
}

function filterItems(limit) {
  return LABATT_CATALOG.filter(item => {
    const q = catalogFilter.toLowerCase();
    const matchSearch = !q ||
      item.description.toLowerCase().includes(q) ||
      item.label.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q);
    const matchCat = !catalogCat || item.category === catalogCat;
    return matchSearch && matchCat;
  }).slice(0, limit || 9999);
}

function assignCatalogItem(labattId) {
  const item = LABATT_CATALOG.find(c => c.id === labattId);
  if (!item || !activeMeal) return;
  const idx = focusedIngIdx !== null ? focusedIngIdx : state[activeMeal].findIndex(i => !i.labattId);
  if (idx === -1) return;
  const ing = state[activeMeal][idx];
  ing.labattId = item.id;
  ing.labattName = item.description;
  ing.packSize = item.packSize;
  ing.unitPrice = item.price;
  focusedIngIdx = null;
  renderMealIngredients();
  renderPlannerTabs();
  updateSidebarTotals();
  logActivity('🔗', `Matched "${ing.name}" → ${item.description} ($${item.price})`);
}

// ══════════════════════════════════
// AI INGREDIENT MATCHER
// ══════════════════════════════════
let aiTargetIdx = null;

function openAIModal(idx) {
  aiTargetIdx = idx !== undefined ? idx : focusedIngIdx;
  const ing = aiTargetIdx !== null ? state[activeMeal]?.[aiTargetIdx] : null;
  document.getElementById('aiSearchInput').value = ing ? ing.name : '';
  document.getElementById('aiResults').innerHTML = '';
  const keyNote = document.getElementById('aiKeyNote');
  keyNote.textContent = SETTINGS.anthropicKey ? '🟢 API key configured' : '⚠️ No API key — add one in Settings for AI matching';
  document.getElementById('aiModal').classList.add('open');
  document.getElementById('aiSearchInput').focus();
}

async function runAIMatch() {
  const query = document.getElementById('aiSearchInput').value.trim();
  if (!query) return;

  const resultsDiv = document.getElementById('aiResults');
  resultsDiv.innerHTML = `<div class="ai-loading"><span class="ai-loading-spinner">🤖</span>Finding best Labatt matches…</div>`;

  // Build a trimmed catalog snapshot for the prompt (top 100 relevant items)
  const words = query.toLowerCase().split(/\s+/).filter(w=>w.length>2);
  const relevant = LABATT_CATALOG
    .filter(item => words.some(w => item.description.toLowerCase().includes(w) || item.category.toLowerCase().includes(w)))
    .slice(0, 80);
  const all_sample = LABATT_CATALOG.filter(i=>i.price>0).slice(0,40);
  const candidates = [...new Map([...relevant,...all_sample].map(i=>[i.id,i])).values()].slice(0,80);

  const catalogStr = candidates.map(i =>
    `${i.id}|${i.label}|${i.description}|${i.packSize}|$${i.price}`
  ).join('\n');

  const systemPrompt = `You are a food purchasing assistant for a school cafeteria. 
Given an ingredient request and a Labatt Foods catalog, find the 3 best matches.
Respond ONLY with valid JSON: {"matches":[{"id":"...","reason":"...","confidence":"high|medium|low","alternative":false},...]}
Order by relevance. Mark the best match alternative:false, others alternative:true.`;

  const userPrompt = `Ingredient needed: "${query}"
Event: ${SETTINGS.eventName}, ${SETTINGS.eventGuests} guests, Jul 2026

Labatt catalog (id|brand|description|packSize|price):
${catalogStr}

Find the 3 best Labatt matches for this ingredient.`;

  try {
    let matches = [];
    if (SETTINGS.anthropicKey) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': SETTINGS.anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:800, system: systemPrompt, messages:[{role:'user',content:userPrompt}] })
      });
      const data = await resp.json();
      const text = data.content?.[0]?.text || '{}';
      const clean = text.replace(/```json|```/g,'').trim();
      matches = JSON.parse(clean).matches || [];
    } else {
      // Fallback: local fuzzy match
      matches = relevant.slice(0,3).map((item, i) => ({
        id: item.id,
        reason: `Keyword match on "${words.find(w=>item.description.toLowerCase().includes(w))||'ingredient name'}" — ${item.description} (${item.packSize})`,
        confidence: i===0?'medium':'low',
        alternative: i>0
      }));
    }

    resultsDiv.innerHTML = matches.map((m, i) => {
      const item = LABATT_CATALOG.find(c=>c.id===m.id);
      if (!item) return '';
      const confColor = m.confidence==='high'?'var(--green)':m.confidence==='medium'?'var(--yellow)':'var(--red)';
      return `<div class="ai-result-card ${i===0?'top':''}">
        <div class="ai-result-rank">${i===0?'⭐ Best Match':`Alternative ${i}`} · <span style="color:${confColor}">${m.confidence} confidence</span></div>
        <div class="ai-result-name">${item.description}</div>
        <div class="ai-result-meta">
          <span>${item.id}</span>
          <span>${item.packSize}</span>
          <span style="color:var(--accent)">${item.price>0?'$'+item.price.toFixed(2):'No price'}</span>
          <span style="color:var(--text3)">${item.label}</span>
        </div>
        <div class="ai-result-reason">${m.reason}</div>
        <div class="ai-result-actions">
          <button class="btn btn-primary btn-sm" onclick="applyAIMatch('${item.id}')">Use This Match</button>
          <button class="btn btn-outline btn-sm" onclick="document.getElementById('aiSearchInput').value='${item.description}';runAIMatch()">Search Similar</button>
        </div>
      </div>`;
    }).join('') || '<div style="padding:20px;text-align:center;color:var(--text3)">No matches found — try different keywords.</div>';

    logActivity('🤖', `AI matched "${query}" in ${MEALS_DEF[activeMeal]?.name || 'catalog'}`);
  } catch(err) {
    resultsDiv.innerHTML = `<div style="padding:20px;color:var(--red);font-size:13px">Error: ${err.message}. Check your API key in Settings.</div>`;
  }
}

function applyAIMatch(labattId) {
  assignCatalogItem(labattId);
  closeModal('aiModal');
}

async function batchAIMatch() {
  if (!activeMeal) return;
  const unmatched = state[activeMeal].filter(i => !i.labattId);
  if (unmatched.length === 0) { showNotif('All ingredients are already matched!', 'info'); return; }
  showNotif(`AI matching ${unmatched.length} unmatched ingredients…`, 'info');
  openAIModal(null);
  document.getElementById('aiSearchInput').value = unmatched.map(i=>i.name).join(', ');
  // For batch, we'll just auto-run for the first unmatched
  const firstUnmatched = state[activeMeal].findIndex(i => !i.labattId);
  if (firstUnmatched >= 0) {
    aiTargetIdx = firstUnmatched;
    document.getElementById('aiSearchInput').value = state[activeMeal][firstUnmatched].name;
    await runAIMatch();
  }
}

// ══════════════════════════════════
// SHARED INGREDIENTS PAGE
// ══════════════════════════════════
function renderSharedPage() {
  const content = document.getElementById('sharedContent');
  const allShared = Object.entries(state).flatMap(([mealId, items]) =>
    items.filter(i=>i.isShared).map(i=>({...i, mealId, mealName:MEALS_DEF[mealId]?.name}))
  );

  // Group by name
  const groups = {};
  allShared.forEach(ing => {
    if (!groups[ing.name]) groups[ing.name] = [];
    groups[ing.name].push(ing);
  });

  // Also include manually added shared entries
  sharedIngredients.forEach(s => {
    if (!groups[s.name]) groups[s.name] = [];
  });

  const savings = Object.values(groups).reduce((sum, group) => {
    if (group.length > 1) {
      const totalCost = group.reduce((s,i)=>s+(i.qtyToBuy*i.unitPrice),0);
      sum += totalCost * (group.length - 1) / group.length;
    }
    return sum;
  }, 0);

  content.innerHTML = `
    <div class="shared-layout">
      <div class="shared-intro">
        <strong>Shared ingredients</strong> appear in multiple meals but should only be purchased once.
        Tag an ingredient as shared from the Meal Planner, then set the cost split here.
        Currently saving <strong style="color:var(--accent)">${fmt(savings)}</strong> by avoiding double-counting.
      </div>

      ${Object.keys(groups).length === 0 ? `
        <div style="text-align:center;padding:50px;color:var(--text3)">
          <div style="font-size:36px;margin-bottom:12px">🔀</div>
          <div style="font-size:16px;color:var(--text2);margin-bottom:8px">No shared ingredients yet</div>
          <div style="font-size:13px;margin-bottom:20px">Go to the Meal Planner and click 🔀 on any ingredient that appears in multiple meals.</div>
          <button class="btn btn-outline" onclick="autoDetectShared()">✨ Auto-detect shared ingredients</button>
        </div>` :
        `<table class="shared-table">
          <thead><tr>
            <th>Ingredient</th>
            <th>Appears In</th>
            <th>Total Cost</th>
            <th>Split</th>
            <th>Cost per Meal</th>
          </tr></thead>
          <tbody>
          ${Object.entries(groups).map(([name, items]) => {
            const totalCost = items.reduce((s,i)=>s+(i.qtyToBuy*i.unitPrice),0);
            const mealList = [...new Set(items.map(i=>i.mealName))];
            const split = mealList.length ? (100/mealList.length).toFixed(0) : 100;
            return `<tr>
              <td><strong>${name}</strong>${items[0]?.labattName?`<div style="font-size:11px;color:var(--text3);font-family:'JetBrains Mono',monospace;margin-top:2px">${items[0].labattName}</div>`:''}</td>
              <td>${mealList.map(m=>`<span class="shared-tag">${m}</span>`).join(' ')}</td>
              <td style="font-family:'JetBrains Mono',monospace;color:var(--accent)">${fmt(totalCost)}</td>
              <td>${mealList.map(m=>`<span class="split-pill">${m.split(' ')[0]}: ${split}%</span>`).join('')}</td>
              <td style="font-family:'JetBrains Mono',monospace;color:var(--text2)">${fmt(totalCost/Math.max(mealList.length,1))}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
        <button class="add-shared-btn" onclick="navigate('planner')">+ Tag more shared ingredients in Planner</button>`
      }
    </div>`;
}

function autoDetectShared() {
  // Find ingredients with same name in multiple meals
  const nameCounts = {};
  Object.entries(state).forEach(([mealId, items]) => {
    items.forEach((ing, idx) => {
      const key = ing.name.toLowerCase().trim();
      if (!nameCounts[key]) nameCounts[key] = [];
      nameCounts[key].push({mealId, idx, name:ing.name});
    });
  });
  let found = 0;
  Object.entries(nameCounts).forEach(([key, occurrences]) => {
    if (occurrences.length > 1) {
      occurrences.forEach(({mealId, idx}) => {
        state[mealId][idx].isShared = true;
        found++;
      });
    }
  });
  renderSharedPage();
  showNotif(`Auto-detected ${found} shared ingredient entries across ${Object.keys(nameCounts).filter(k=>nameCounts[k].length>1).length} ingredient names.`, 'info');
  logActivity('✨', `Auto-detected ${found} shared ingredients`);
}

// ══════════════════════════════════
// CATALOG BROWSER PAGE
// ══════════════════════════════════
function buildCatPillsPage() {
  const el = document.getElementById('catPillsPage');
  if (!el) return;
  el.innerHTML = `<button class="cat-pill ${!catalogCat?'active':''}" onclick="setCatalogCat('')">All</button>` +
    CATEGORIES.map(c => `<button class="cat-pill ${catalogCat===c?'active':''}" onclick="setCatalogCat('${c}')">${c}</button>`).join('');
}

function filterCatalogPage() {
  catalogFilter = document.getElementById('catalogPageSearch')?.value || '';
  renderCatalogPage();
  renderCatalogSidebar();
}

function sortCatalog(key) {
  if (catalogSortKey === key) catalogSortDir *= -1;
  else { catalogSortKey = key; catalogSortDir = 1; }
  renderCatalogPage();
}

function renderCatalogPage() {
  const el = document.getElementById('catalogTableBody');
  if (!el) return;
  let items = filterItems();
  items.sort((a,b) => {
    let va = a[catalogSortKey], vb = b[catalogSortKey];
    if (catalogSortKey === 'price') { va = Number(va); vb = Number(vb); }
    else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
    return va < vb ? -catalogSortDir : va > vb ? catalogSortDir : 0;
  });

  const q = catalogFilter;
  el.innerHTML = items.map(item => {
    const hl = t => q ? t.replace(new RegExp(`(${escRe(q)})`, 'gi'), '<span class="ci-highlight">$1</span>') : t;
    return `<tr>
      <td class="id-cell">${hl(item.id)}</td>
      <td><span class="label-chip">${hl(item.label)}</span></td>
      <td>${hl(item.description)}</td>
      <td class="pack-cell">${item.packSize}</td>
      <td><span class="cat-chip">${item.category}</span></td>
      <td class="price-cell ${item.price===0?'noprice':''}">${item.price>0?'$'+item.price.toFixed(2):'No price'}</td>
      <td><button class="btn btn-xs btn-outline" onclick="assignCatalogItem('${item.id}');navigate('planner')">+ Add to meal</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text3)">No results</td></tr>`;
}

// ══════════════════════════════════
// ORDER SHEET
// ══════════════════════════════════
function renderOrderSheet() {
  const wrap = document.getElementById('orderSheetContent');
  if (!wrap) return;

  // Aggregate all matched items
  const itemMap = {};
  const unmatched = [];

  Object.entries(state).forEach(([mealId, items]) => {
    const mealName = MEALS_DEF[mealId]?.name;
    items.forEach(ing => {
      if (ing.labattId) {
        if (!itemMap[ing.labattId]) {
          itemMap[ing.labattId] = {
            id: ing.labattId, name: ing.labattName, packSize: ing.packSize,
            unitPrice: ing.unitPrice, meals: [], totalQty: 0,
          };
        }
        itemMap[ing.labattId].meals.push({ meal: mealName, qty: ing.qtyToBuy, ingName: ing.name });
        itemMap[ing.labattId].totalQty += ing.qtyToBuy;
      } else {
        unmatched.push({ ...ing, mealName });
      }
    });
  });

  const sorted = Object.values(itemMap).sort((a,b) => a.id.localeCompare(b.id));
  const orderTotal = sorted.reduce((s,i) => s+(i.totalQty*i.unitPrice), 0);

  wrap.innerHTML = `<div class="order-sheet-wrap">
    <div class="order-event-header">
      <div>
        <div class="oeh-title">${SETTINGS.eventName}</div>
        <div class="oeh-meta">${SETTINGS.eventDates} · ${SETTINGS.eventGuests} guests · Generated ${new Date().toLocaleDateString()}</div>
      </div>
      <div class="oeh-total">
        <div class="oeh-total-label">Order Total</div>
        <div class="oeh-total-amt">${fmt(orderTotal)}</div>
      </div>
    </div>

    <table class="order-table">
      <thead><tr>
        <th>Item #</th>
        <th>Brand</th>
        <th>Description</th>
        <th>Pack Size</th>
        <th>Used In</th>
        <th>Qty</th>
        <th>Unit Price</th>
        <th>Total</th>
      </tr></thead>
      <tbody>
        ${sorted.map(item => `<tr>
          <td class="pack-cell">${item.id}</td>
          <td><span class="label-chip">${LABATT_CATALOG.find(c=>c.id===item.id)?.label||''}</span></td>
          <td>${item.name}</td>
          <td class="pack-cell">${item.packSize}</td>
          <td style="font-size:11px;color:var(--text3)">${item.meals.map(m=>`${m.meal} (${m.qty})`).join(', ')}</td>
          <td style="text-align:center;font-family:'JetBrains Mono',monospace;font-weight:600">${item.totalQty}</td>
          <td class="price-cell">$${item.unitPrice.toFixed(2)}</td>
          <td class="price-cell">$${(item.totalQty*item.unitPrice).toFixed(2)}</td>
        </tr>`).join('')}
        <tr class="total-row">
          <td colspan="6">ORDER TOTAL</td>
          <td></td>
          <td>${fmt(orderTotal)}</td>
        </tr>
      </tbody>
    </table>

    ${unmatched.length > 0 ? `
    <div class="unmatched-section">
      <div class="unmatched-title">⚠️ ${unmatched.length} items without Labatt matches — source separately</div>
      ${unmatched.map(i=>`<div class="unmatched-item">• ${i.name} <span style="color:var(--text3)">(${i.mealName})</span> — ${i.note}</div>`).join('')}
    </div>` : ''}
  </div>`;
}

function printOrderSheet() {
  window.print();
}

function exportOrderCSV() {
  const items = [];
  items.push('Item #,Brand,Description,Pack Size,Used In,Qty,Unit Price,Total');
  const itemMap = {};
  Object.entries(state).forEach(([mealId, ings]) => {
    ings.filter(i=>i.labattId).forEach(ing => {
      if (!itemMap[ing.labattId]) itemMap[ing.labattId] = {...ing, meals:[], totalQty:0};
      itemMap[ing.labattId].meals.push(MEALS_DEF[mealId]?.name);
      itemMap[ing.labattId].totalQty += ing.qtyToBuy;
    });
  });
  Object.values(itemMap).sort((a,b)=>a.labattId.localeCompare(b.labattId)).forEach(i => {
    items.push(`${i.labattId},"${LABATT_CATALOG.find(c=>c.id===i.labattId)?.label||''}","${i.labattName}","${i.packSize}","${i.meals.join('; ')}",${i.totalQty},${i.unitPrice.toFixed(2)},${(i.totalQty*i.unitPrice).toFixed(2)}`);
  });
  download(items.join('\n'), `${SETTINGS.eventName.replace(/\s+/g,'_')}_Order.csv`, 'text/csv');
}

async function exportToSheets() {
  if (!SETTINGS.sheetsUrl) {
    showNotif('Add your Google Sheets URL in Settings first.', 'warn');
    navigate('settings');
    return;
  }
  showNotif('Google Sheets export requires deployment to GitHub Pages with a backend proxy. Configure in Settings.', 'info');
}

// ══════════════════════════════════
// BUDGET HISTORY
// ══════════════════════════════════
function renderHistoryPage() {
  const wrap = document.getElementById('historyContent');
  if (!wrap) return;

  if (history.length === 0) {
    wrap.innerHTML = `<div class="history-wrap">
      <div class="history-empty">
        <div class="history-empty-icon">📚</div>
        <div class="history-empty-title">No saved budgets yet</div>
        <p style="font-size:13px;color:var(--text3);margin-bottom:20px;max-width:400px;margin-left:auto;margin-right:auto">
          Save this budget to start building a history. You'll be able to compare costs across events, track price changes, and plan more accurately each semester.
        </p>
        <button class="btn btn-primary" onclick="saveCurrentBudget()">💾 Save Current Budget</button>
      </div>
    </div>`;
    return;
  }

  const gt = grandTotal();
  wrap.innerHTML = `<div class="history-wrap">
    <div class="history-grid">
      ${history.map((h, i) => `
        <div class="history-card">
          <div class="hc-name">${h.eventName}</div>
          <div class="hc-date">${h.savedAt} · ${h.guests} guests</div>
          <div class="hc-total">${fmt(h.total)}</div>
          <div class="hc-guests">$${(h.total/h.guests).toFixed(2)}/guest</div>
          ${gt > 0 ? `<div class="hc-per-guest" style="color:${h.total<gt?'var(--green)':'var(--red)'}">
            ${h.total < gt ? '▼' : '▲'} ${fmt(Math.abs(gt-h.total))} vs current
          </div>` : ''}
          <div class="hc-actions">
            <button class="btn btn-outline btn-sm" onclick="loadHistoryBudget(${i})">Load</button>
            <button class="btn btn-danger btn-sm" onclick="deleteHistory(${i})">Delete</button>
          </div>
        </div>`).join('')}
    </div>
  </div>`;
}

function saveCurrentBudget() {
  document.getElementById('saveEventName').value = SETTINGS.eventName;
  document.getElementById('saveNotes').value = '';
  document.getElementById('saveModal').classList.add('open');
}

function confirmSave() {
  const name = document.getElementById('saveEventName').value || SETTINGS.eventName;
  const gt = grandTotal();
  history.unshift({
    eventName: name,
    savedAt: new Date().toLocaleDateString(),
    guests: SETTINGS.eventGuests,
    total: gt,
    state: JSON.parse(JSON.stringify(state)),
    notes: document.getElementById('saveNotes').value,
  });
  localStorage.setItem('cb_history', JSON.stringify(history));
  closeModal('saveModal');
  showNotif(`Budget saved as "${name}"`, 'ok');
  logActivity('💾', `Saved budget: "${name}" — ${fmt(gt)}`);
  renderHistoryPage();
}

function loadHistoryBudget(idx) {
  if (!confirm('Load this budget? Your current data will be overwritten.')) return;
  state = JSON.parse(JSON.stringify(history[idx].state));
  activeMeal = Object.keys(state)[0];
  navigate('dashboard');
  showNotif(`Loaded "${history[idx].eventName}"`, 'ok');
  logActivity('📂', `Loaded historical budget: "${history[idx].eventName}"`);
}

function deleteHistory(idx) {
  if (!confirm('Delete this budget?')) return;
  history.splice(idx, 1);
  localStorage.setItem('cb_history', JSON.stringify(history));
  renderHistoryPage();
}

// ══════════════════════════════════
// SETTINGS PAGE
// ══════════════════════════════════
function renderSettingsPage() {
  document.getElementById('settingsContent').innerHTML = `
  <div class="settings-wrap">

    <div class="settings-section">
      <div class="settings-section-header">📅 Event Details</div>
      <div class="settings-section-body">
        <div class="field-group">
          <label class="field-label">Event Name</label>
          <input class="field-input" type="text" value="${SETTINGS.eventName}" oninput="saveSetting('eventName',this.value);document.getElementById('sidebarEventName').textContent=this.value">
        </div>
        <div class="field-row">
          <div class="field-group">
            <label class="field-label">Event Dates</label>
            <input class="field-input" type="text" value="${SETTINGS.eventDates}" placeholder="Jul 17–19, 2026" oninput="saveSetting('eventDates',this.value);document.getElementById('sidebarEventDate').textContent=this.value+' · '+SETTINGS.eventGuests+' guests'">
          </div>
          <div class="field-group">
            <label class="field-label">Number of Guests</label>
            <input class="field-input" type="number" value="${SETTINGS.eventGuests}" oninput="saveSetting('eventGuests',parseInt(this.value)||160);updateSidebarTotals()">
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Budget Buffer (%)</label>
          <input class="field-input" type="number" value="${(SETTINGS.buffer*100).toFixed(0)}" min="0" max="50" oninput="saveSetting('buffer',parseFloat(this.value)/100||0.1);updateSidebarTotals()">
          <div class="field-note">Applied to grand total on Dashboard and Order Sheet.</div>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-header">🤖 Anthropic AI (Ingredient Matching)</div>
      <div class="settings-section-body">
        <div class="field-group">
          <label class="field-label">API Key</label>
          <input class="field-input" type="password" value="${SETTINGS.anthropicKey}" placeholder="sk-ant-…" oninput="saveSetting('anthropicKey',this.value)">
          <div class="field-note">Used for AI ingredient matching. Your key is stored locally in your browser and never sent anywhere except Anthropic's API. Get a key at console.anthropic.com.</div>
        </div>
        <div>
          <span class="integration-status">
            <span class="status-dot ${SETTINGS.anthropicKey?'connected':'disconnected'}"></span>
            ${SETTINGS.anthropicKey?'API key configured':'Not configured'}
          </span>
        </div>
        <button class="btn btn-outline btn-sm" onclick="testAI()">Test AI Connection</button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-header">📊 Google Sheets Integration</div>
      <div class="settings-section-body">
        <div class="field-group">
          <label class="field-label">Google Sheets URL</label>
          <input class="field-input" type="text" value="${SETTINGS.sheetsUrl}" placeholder="https://docs.google.com/spreadsheets/d/…" oninput="saveSetting('sheetsUrl',this.value)">
          <div class="field-note">Link to your master price sheet. When deployed to GitHub Pages, prices will sync automatically. For now, use the Export CSV feature and upload manually.</div>
        </div>
        <span class="integration-status">
          <span class="status-dot ${SETTINGS.sheetsUrl?'pending':'disconnected'}"></span>
          ${SETTINGS.sheetsUrl?'URL saved — activate on GitHub Pages':'Not configured'}
        </span>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-header">☁️ Google Drive (Save & Sync)</div>
      <div class="settings-section-body">
        <div class="field-group">
          <label class="field-label">Drive Folder ID</label>
          <input class="field-input" type="text" value="${SETTINGS.driveFolder}" placeholder="Folder ID from Google Drive URL" oninput="saveSetting('driveFolder',this.value)">
          <div class="field-note">Budgets will save as JSON files in this folder. Full sync activates when deployed to GitHub Pages with OAuth configured.</div>
        </div>
        <span class="integration-status">
          <span class="status-dot ${SETTINGS.driveFolder?'pending':'disconnected'}"></span>
          ${SETTINGS.driveFolder?'Folder configured — activate on GitHub Pages':'Not configured'}
        </span>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-header">👥 Collaboration</div>
      <div class="settings-section-body">
        <div class="field-group">
          <label class="field-label">Access PIN (for co-planner)</label>
          <input class="field-input" type="text" value="${SETTINGS.collab_pin}" placeholder="4-digit PIN" maxlength="6" oninput="saveSetting('collab_pin',this.value)">
          <div class="field-note">When deployed, share your GitHub Pages URL with this PIN. Your co-planner can view and edit the budget. Changes sync in real-time via Google Drive.</div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="copyShareLink()">📋 Copy Share Link</button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-header">⚙️ Preferences</div>
      <div class="settings-section-body">
        <div class="settings-toggle">
          <div>
            <div style="font-size:13px;font-weight:500">Auto-save</div>
            <div class="field-note">Save state to browser every 30 seconds</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" ${SETTINGS.autoSave?'checked':''} onchange="saveSetting('autoSave',this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-header">🗂️ Data Management</div>
      <div class="settings-section-body">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-outline" onclick="exportAllData()">⬇️ Export All Data</button>
          <button class="btn btn-outline" onclick="importData()">⬆️ Import Data</button>
          <button class="btn btn-danger" onclick="resetData()">🗑️ Reset All Data</button>
        </div>
        <div class="field-note">Export creates a full JSON backup of all budgets, history, and settings. Import restores from a previous export.</div>
      </div>
    </div>

  </div>`;
}

async function testAI() {
  if (!SETTINGS.anthropicKey) { showNotif('Add your API key first.', 'warn'); return; }
  showNotif('Testing AI connection…', 'info');
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':SETTINGS.anthropicKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body: JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:50,messages:[{role:'user',content:'Say "AI connection OK" and nothing else.'}]})
    });
    const d = await resp.json();
    showNotif('✅ ' + (d.content?.[0]?.text || 'AI connected!'), 'ok');
  } catch(e) {
    showNotif('❌ Connection failed: ' + e.message, 'warn');
  }
}

function copyShareLink() {
  navigator.clipboard.writeText(window.location.href + '?pin=' + SETTINGS.collab_pin);
  showNotif('Share link copied! Works fully once deployed to GitHub Pages.', 'ok');
}

// ══════════════════════════════════
// EXPORT / IMPORT
// ══════════════════════════════════
function exportMealCSV() {
  const rows = ['Meal,Ingredient,Labatt ID,Description,Pack Size,Unit,Qty,Unit Price,Line Total,Notes'];
  Object.entries(MEALS_DEF).forEach(([mealId, meal]) => {
    (state[mealId]||[]).forEach(ing => {
      rows.push([meal.name, `"${ing.name}"`, ing.labattId, `"${ing.labattName}"`, `"${ing.packSize}"`, ing.unit, ing.qtyToBuy, ing.unitPrice.toFixed(2), (ing.qtyToBuy*ing.unitPrice).toFixed(2), `"${ing.note}"`].join(','));
    });
    rows.push([`${meal.name} SUBTOTAL`,'','','','','','','',mealTotal(mealId).toFixed(2),''].join(','));
    rows.push('');
  });
  const gt = grandTotal();
  rows.push(['GRAND TOTAL','','','','','','','',gt.toFixed(2),''].join(','));
  rows.push(['WITH BUFFER','','','','','','','',(gt*(1+SETTINGS.buffer)).toFixed(2),''].join(','));

  const csv = rows.join('\n');
  document.getElementById('exportPreview').textContent = csv;
  document.getElementById('exportModal').classList.add('open');
  window._exportCSV = csv;
}

function copyExport() {
  navigator.clipboard.writeText(window._exportCSV || '');
  const f = document.getElementById('copyFlash');
  f.classList.add('show');
  setTimeout(() => f.classList.remove('show'), 2000);
}

function downloadExport() {
  download(window._exportCSV || '', `${SETTINGS.eventName.replace(/\s+/g,'_')}_Budget.csv`, 'text/csv');
}

function exportAllData() {
  const data = { state, history, sharedIngredients, settings: SETTINGS, exportedAt: new Date().toISOString() };
  download(JSON.stringify(data, null, 2), `CampBudget_Backup_${new Date().toISOString().split('T')[0]}.json`, 'application/json');
  logActivity('⬇️', 'Exported full data backup');
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.state) { state = data.state; activeMeal = Object.keys(state)[0]; }
        if (data.history) history = data.history;
        if (data.sharedIngredients) sharedIngredients = data.sharedIngredients;
        autoSave();
        navigate('dashboard');
        showNotif('Data imported successfully!', 'ok');
        logActivity('⬆️', `Imported backup from ${file.name}`);
      } catch(err) {
        showNotif('Import failed: invalid file format.', 'warn');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function resetData() {
  if (!confirm('Reset ALL data? This cannot be undone.')) return;
  localStorage.clear();
  window.location.reload();
}

// ══════════════════════════════════
// NEW EVENT
// ══════════════════════════════════
function newEvent() {
  document.getElementById('newEventMeals').innerHTML = [
    {label:'Friday Dinner 🍕', val:'fri-dinner'},
    {label:'Saturday Breakfast 🍳', val:'sat-breakfast'},
    {label:'Saturday Lunch 🍔', val:'sat-lunch'},
    {label:'Saturday Dinner 🍝', val:'sat-dinner'},
    {label:'Saturday Snacks 🍎', val:'sat-snacks'},
    {label:'Sunday Breakfast 🌮', val:'sun-breakfast'},
  ].map(m => `<div class="meal-cb-item">
    <input type="checkbox" id="ncm-${m.val}" value="${m.val}" checked>
    <label for="ncm-${m.val}">${m.label}</label>
  </div>`).join('');
  document.getElementById('newEventModal').classList.add('open');
}

function createNewEvent() {
  const name = document.getElementById('newEventName').value || 'New Event';
  const guests = parseInt(document.getElementById('newEventGuests').value || '160');
  saveSetting('eventName', name);
  saveSetting('eventGuests', guests);
  document.getElementById('sidebarEventName').textContent = name;

  const checked = [...document.querySelectorAll('#newEventMeals input:checked')].map(i=>i.value);
  state = {};
  checked.forEach(mealId => {
    if (MEALS_DEF[mealId]) {
      state[mealId] = MEALS_DEF[mealId].ingredients.map(ing => ({
        name: ing.name, unit: ing.unit, qtyToBuy: ing.qtyNeeded,
        unitPrice: 0, note: ing.note||'', labattId:'', labattName:'', packSize:'', isShared:false
      }));
      autoMatchMeal(mealId);
    }
  });
  activeMeal = checked[0] || Object.keys(MEALS_DEF)[0];
  closeModal('newEventModal');
  navigate('dashboard');
  showNotif(`Created new event: "${name}"`, 'ok');
  logActivity('📅', `Created new event: "${name}" with ${checked.length} meals`);
}

// ══════════════════════════════════
// UTILITIES
// ══════════════════════════════════
function mealTotal(mealId) {
  return (state[mealId] || []).reduce((s, i) => s + (i.qtyToBuy * i.unitPrice), 0);
}
function grandTotal() {
  return Object.keys(state).reduce((s, id) => s + mealTotal(id), 0);
}
function fmt(n) {
  return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateSidebarTotals() {
  const gt = grandTotal();
  const el = document.getElementById('sidebarTotal');
  const buf = document.getElementById('sidebarBuffer');
  if (el) el.textContent = fmt(gt);
  if (buf) buf.textContent = `+${(SETTINGS.buffer*100).toFixed(0)}% buffer: ${fmt(gt*(1+SETTINGS.buffer))}`;
}

function showNotif(msg, type='info') {
  const bar = document.getElementById('notifBar');
  const msgEl = document.getElementById('notifMsg');
  bar.style.display = 'flex';
  bar.style.background = type==='ok'?'var(--green)':type==='warn'?'var(--accent2)':'var(--accent3)';
  msgEl.textContent = msg;
  setTimeout(() => { bar.style.display='none'; }, 4000);
}
function dismissNotif() {
  document.getElementById('notifBar').style.display = 'none';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function download(content, filename, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function uploadNewCatalog() {
  showNotif('To update the catalog, export a new CSV from your Labatt velocity report and upload it here to re-generate data.js.', 'info');
}
