// ── Starfield ──────────────────────────────────────────────────
const canvas = document.getElementById('stars');
const ctx = canvas.getContext('2d');
let stars = [];

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

function initStars(count = 200) {
  stars = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 1.5 + 0.3,
    alpha: Math.random(),
    speed: Math.random() * 0.4 + 0.1,
    dir: Math.random() * Math.PI * 2,
  }));
}

function drawStars() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  stars.forEach(s => {
    s.x += Math.cos(s.dir) * s.speed * 0.15;
    s.y += Math.sin(s.dir) * s.speed * 0.15;
    s.alpha += (Math.random() - 0.5) * 0.03;
    s.alpha = Math.max(0.1, Math.min(1, s.alpha));
    if (s.x < 0) s.x = canvas.width;
    if (s.x > canvas.width) s.x = 0;
    if (s.y < 0) s.y = canvas.height;
    if (s.y > canvas.height) s.y = 0;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(180, 200, 255, ${s.alpha})`;
    ctx.fill();
  });
  requestAnimationFrame(drawStars);
}

window.addEventListener('resize', () => { resizeCanvas(); initStars(); });
resizeCanvas();
initStars();
drawStars();

// ── API helpers ────────────────────────────────────────────────
const api = {
  async get(url)            { const r = await fetch(url); return r.json(); },
  async post(url, body)     { const r = await fetch(url, { method:'POST',  headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); return r.json(); },
  async patch(url, body)    { const r = await fetch(url, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); return r.json(); },
  async delete(url)         { await fetch(url, { method:'DELETE' }); },
};

// ── State ──────────────────────────────────────────────────────
let allTasks = [];
let activeFilter = 'all';

// ── Render ─────────────────────────────────────────────────────
function renderStats(stats) {
  document.querySelector('#stat-total  .stat-value').textContent = stats.total;
  document.querySelector('#stat-done   .stat-value').textContent = stats.completed;
  document.querySelector('#stat-pending .stat-value').textContent = stats.pending;
  document.querySelector('#stat-high   .stat-value').textContent = stats.high_priority;

  const pct = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-pct').textContent  = pct + '%';
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function renderTasks(tasks) {
  const container = document.getElementById('tasks-container');
  const filtered = tasks.filter(t => {
    if (activeFilter === 'pending')   return !t.completed;
    if (activeFilter === 'completed') return  t.completed;
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="emoji">🌌</div>
        <p>No missions found in this sector.</p>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(t => `
    <div class="task-card ${t.completed ? 'done' : ''} priority-${t.priority}" data-id="${t.id}">
      <div class="task-check" onclick="toggleTask(${t.id}, ${!t.completed})"></div>
      <div class="task-body">
        <div class="task-title">${escHtml(t.title)}</div>
        ${t.description ? `<div class="task-desc">${escHtml(t.description)}</div>` : ''}
        <div class="task-meta">
          <span class="priority-badge ${t.priority}">${t.priority}</span>
          <span class="task-date">${fmtDate(t.created_at)}</span>
        </div>
      </div>
      <button class="task-delete" onclick="deleteTask(${t.id})" title="Delete">✕</button>
    </div>
  `).join('');
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Data loading ───────────────────────────────────────────────
async function loadAll() {
  const [tasks, stats] = await Promise.all([
    api.get('/api/tasks'),
    api.get('/api/stats'),
  ]);
  allTasks = tasks;
  renderStats(stats);
  renderTasks(tasks);
}

// ── Actions ────────────────────────────────────────────────────
async function toggleTask(id, completed) {
  await api.patch(`/api/tasks/${id}`, { completed });
  loadAll();
}

async function deleteTask(id) {
  const card = document.querySelector(`.task-card[data-id="${id}"]`);
  if (card) { card.style.opacity = '0'; card.style.transform = 'scale(0.95)'; card.style.transition = '0.2s'; }
  setTimeout(async () => { await api.delete(`/api/tasks/${id}`); loadAll(); }, 200);
}

// ── Form ───────────────────────────────────────────────────────
document.getElementById('task-form').addEventListener('submit', async e => {
  e.preventDefault();
  const title    = document.getElementById('task-title').value.trim();
  const desc     = document.getElementById('task-desc').value.trim();
  const priority = document.getElementById('task-priority').value;
  if (!title) return;
  await api.post('/api/tasks', { title, description: desc, priority });
  e.target.reset();
  document.getElementById('task-priority').value = 'medium';
  loadAll();
});

// ── Filters ────────────────────────────────────────────────────
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderTasks(allTasks);
  });
});

// ── Init ───────────────────────────────────────────────────────
loadAll();
