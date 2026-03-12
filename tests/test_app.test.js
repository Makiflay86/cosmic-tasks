/**
 * Jest test suite for cosmic-tasks frontend (app.js)
 * Environment: jsdom (configured in package.json)
 */

const fs   = require('fs');
const path = require('path');

const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../static/app.js'), 'utf8');

function makeFetchMock() {
  return jest.fn().mockImplementation((url, opts) => {
    const method = (opts && opts.method) || 'GET';
    if (method === 'GET') {
      if (url === '/api/tasks') return Promise.resolve({ json: async () => [] });
      if (url === '/api/stats') return Promise.resolve({ json: async () => ({ total: 0, completed: 0, pending: 0, high_priority: 0 }) });
    }
    return Promise.resolve({ json: async () => ({}) });
  });
}

const ctx2d = { clearRect: jest.fn(), beginPath: jest.fn(), arc: jest.fn(), fill: jest.fn(), fillStyle: '' };
const canvasEl = { getContext: jest.fn(() => ctx2d), width: 1024, height: 768 };

function buildFullDom() {
  document.body.innerHTML = `
    <canvas id="stars"></canvas>
    <div id="stat-total">  <span class="stat-value"></span></div>
    <div id="stat-done">   <span class="stat-value"></span></div>
    <div id="stat-pending"><span class="stat-value"></span></div>
    <div id="stat-high">   <span class="stat-value"></span></div>
    <div id="progress-fill" style="width:0%"></div>
    <div id="progress-pct"></div>
    <div id="tasks-container"></div>
    <form id="task-form">
      <input id="task-title" type="text" value="" />
      <textarea id="task-desc"></textarea>
      <select id="task-priority">
        <option value="low">low</option>
        <option value="medium" selected>medium</option>
        <option value="high">high</option>
      </select>
      <button type="submit">Add</button>
    </form>
    <button class="filter-btn active" data-filter="all">All</button>
    <button class="filter-btn" data-filter="pending">Pending</button>
    <button class="filter-btn" data-filter="completed">Completed</button>
  `;
}

global.requestAnimationFrame = jest.fn();
global.fetch = makeFetchMock();

const origGetElementById = document.getElementById.bind(document);
jest.spyOn(document, 'getElementById').mockImplementation((id) => {
  if (id === 'stars') return canvasEl;
  return origGetElementById(id);
});

buildFullDom();
window.eval(APP_SRC); // eslint-disable-line no-eval

async function flushPromises(rounds = 8) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

function resetDom() {
  global.fetch = makeFetchMock();
  buildFullDom();
  window.eval(APP_SRC); // eslint-disable-line no-eval
  global.allTasks = [];
  setFilter('all');
}

function setFilter(value) {
  const btn = document.querySelector(`.filter-btn[data-filter="${value}"]`);
  if (btn) btn.click();
}

describe('escHtml()', () => {
  test('escapes ampersand', () => { expect(escHtml('a & b')).toBe('a &amp; b'); });
  test('escapes less-than', () => { expect(escHtml('<script>')).toBe('&lt;script&gt;'); });
  test('escapes greater-than', () => { expect(escHtml('a > b')).toBe('a &gt; b'); });
  test('escapes double quote', () => { expect(escHtml('"hello"')).toBe('&quot;hello&quot;'); });
  test('escapes all specials combined', () => { expect(escHtml('<a href="x&y">')).toBe('&lt;a href=&quot;x&amp;y&quot;&gt;'); });
  test('returns empty string unchanged', () => { expect(escHtml('')).toBe(''); });
  test('leaves plain text unchanged', () => { expect(escHtml('Hello World')).toBe('Hello World'); });
});

describe('fmtDate()', () => {
  test('"2024-01-15" → "Jan 15, 2024"', () => { expect(fmtDate('2024-01-15')).toBe('Jan 15, 2024'); });
  test('"2024-12-31" → "Dec 31, 2024"', () => { expect(fmtDate('2024-12-31')).toBe('Dec 31, 2024'); });
  test('"2000-06-01" → "Jun 1, 2000"', () => { expect(fmtDate('2000-06-01')).toBe('Jun 1, 2000'); });
  test('"1999-11-09" → "Nov 9, 1999"', () => { expect(fmtDate('1999-11-09')).toBe('Nov 9, 1999'); });
  test('"2024-07-04" → "Jul 4, 2024"', () => { expect(fmtDate('2024-07-04')).toBe('Jul 4, 2024'); });
  test('"2024-10-31" → "Oct 31, 2024"', () => { expect(fmtDate('2024-10-31')).toBe('Oct 31, 2024'); });
});

describe('renderStats()', () => {
  beforeEach(() => { resetDom(); });
  test('sets stat-value textContent for all four counters', () => {
    renderStats({ total: 10, completed: 4, pending: 6, high_priority: 2 });
    expect(document.querySelector('#stat-total   .stat-value').textContent).toBe('10');
    expect(document.querySelector('#stat-done    .stat-value').textContent).toBe('4');
    expect(document.querySelector('#stat-pending .stat-value').textContent).toBe('6');
    expect(document.querySelector('#stat-high    .stat-value').textContent).toBe('2');
  });
  test('progress bar 0% when total is 0', () => {
    renderStats({ total: 0, completed: 0, pending: 0, high_priority: 0 });
    expect(document.getElementById('progress-fill').style.width).toBe('0%');
  });
  test('progress bar 50% when half complete', () => {
    renderStats({ total: 4, completed: 2, pending: 2, high_priority: 0 });
    expect(document.getElementById('progress-fill').style.width).toBe('50%');
  });
  test('progress bar 100% when all complete', () => {
    renderStats({ total: 5, completed: 5, pending: 0, high_priority: 0 });
    expect(document.getElementById('progress-fill').style.width).toBe('100%');
  });
  test('progress rounds to nearest integer (1 of 3 ≈ 33%)', () => {
    renderStats({ total: 3, completed: 1, pending: 2, high_priority: 0 });
    expect(document.getElementById('progress-fill').style.width).toBe('33%');
  });
});

describe('renderTasks()', () => {
  const TASKS = [
    { id: 1, title: 'Task Alpha', description: 'desc a', priority: 'high',   completed: false, created_at: '2024-01-15' },
    { id: 2, title: 'Task Beta',  description: '',       priority: 'medium', completed: true,  created_at: '2024-03-07' },
    { id: 3, title: 'Task Gamma', description: 'desc c', priority: 'low',    completed: false, created_at: '2024-07-04' },
  ];
  beforeEach(() => { resetDom(); });
  test('renders N cards for N tasks', () => { renderTasks(TASKS); expect(document.querySelectorAll('.task-card').length).toBe(3); });
  test('shows empty state when tasks array is empty', () => { renderTasks([]); expect(document.querySelector('.empty-state')).not.toBeNull(); });
  test('filter "pending" shows only incomplete tasks', () => { setFilter('pending'); renderTasks(TASKS); expect(document.querySelectorAll('.task-card').length).toBe(2); });
  test('filter "completed" shows only completed tasks', () => { setFilter('completed'); renderTasks(TASKS); expect(document.querySelectorAll('.task-card').length).toBe(1); });
  test('filter "all" shows all tasks', () => { setFilter('all'); renderTasks(TASKS); expect(document.querySelectorAll('.task-card').length).toBe(3); });
  test('card has priority class matching task priority', () => {
    renderTasks(TASKS);
    const cards = document.querySelectorAll('.task-card');
    expect(cards[0].classList.contains('priority-high')).toBe(true);
    expect(cards[1].classList.contains('priority-medium')).toBe(true);
    expect(cards[2].classList.contains('priority-low')).toBe(true);
  });
  test('completed task card has "done" class', () => { renderTasks(TASKS); expect(document.querySelectorAll('.task-card')[1].classList.contains('done')).toBe(true); });
  test('incomplete task card does not have "done" class', () => { renderTasks(TASKS); expect(document.querySelectorAll('.task-card')[0].classList.contains('done')).toBe(false); });
  test('task title is HTML-escaped in output', () => {
    renderTasks([{ id: 99, title: '<b>XSS</b>', description: '', priority: 'low', completed: false, created_at: '2024-01-01' }]);
    expect(document.getElementById('tasks-container').innerHTML).toContain('&lt;b&gt;XSS&lt;/b&gt;');
  });
  test('card data-id attribute matches task id', () => {
    renderTasks(TASKS);
    const cards = document.querySelectorAll('.task-card');
    expect(cards[0].dataset.id).toBe('1');
    expect(cards[2].dataset.id).toBe('3');
  });
  test('shows empty state when filter yields no matching tasks', () => {
    setFilter('completed');
    renderTasks(TASKS.map(t => ({ ...t, completed: false })));
    expect(document.querySelector('.empty-state')).not.toBeNull();
  });
});

describe('toggleTask()', () => {
  beforeEach(() => { resetDom(); fetch.mockClear(); });
  test('calls fetch with PATCH method and correct URL', async () => {
    await toggleTask(42, true);
    const patchCall = fetch.mock.calls.find(([, opts]) => opts && opts.method === 'PATCH');
    expect(patchCall).toBeDefined();
    expect(patchCall[0]).toBe('/api/tasks/42');
  });
  test('sends completed:true in request body', async () => {
    await toggleTask(7, true);
    const patchCall = fetch.mock.calls.find(([, opts]) => opts && opts.method === 'PATCH');
    expect(JSON.parse(patchCall[1].body)).toEqual({ completed: true });
  });
  test('sends completed:false when unchecking', async () => {
    await toggleTask(7, false);
    const patchCall = fetch.mock.calls.find(([, opts]) => opts && opts.method === 'PATCH');
    expect(JSON.parse(patchCall[1].body)).toEqual({ completed: false });
  });
  test('sets Content-Type header to application/json', async () => {
    await toggleTask(1, true);
    const patchCall = fetch.mock.calls.find(([, opts]) => opts && opts.method === 'PATCH');
    expect(patchCall[1].headers['Content-Type']).toBe('application/json');
  });
});

describe('deleteTask()', () => {
  beforeEach(() => { resetDom(); fetch.mockClear(); jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });
  function addTaskCard(id) {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.dataset.id = String(id);
    document.getElementById('tasks-container').appendChild(card);
    return card;
  }
  test('calls fetch with DELETE method after 200 ms timeout', async () => {
    addTaskCard(5); deleteTask(5);
    expect(fetch.mock.calls.find(([, opts]) => opts && opts.method === 'DELETE')).toBeUndefined();
    jest.advanceTimersByTime(200);
    await flushPromises();
    const delCall = fetch.mock.calls.find(([, opts]) => opts && opts.method === 'DELETE');
    expect(delCall).toBeDefined();
    expect(delCall[0]).toBe('/api/tasks/5');
  });
  test('applies fade-out opacity style to card immediately', () => {
    const card = addTaskCard(8); deleteTask(8);
    expect(card.style.opacity).toBe('0');
  });
  test('applies scale transform to card immediately', () => {
    const card = addTaskCard(11); deleteTask(11);
    expect(card.style.transform).toBe('scale(0.95)');
  });
  test('uses correct task id in DELETE URL', async () => {
    addTaskCard(99); deleteTask(99);
    jest.advanceTimersByTime(200);
    await flushPromises();
    expect(fetch.mock.calls.find(([, opts]) => opts && opts.method === 'DELETE')[0]).toBe('/api/tasks/99');
  });
});

describe('form submit', () => {
  beforeEach(() => { resetDom(); fetch.mockClear(); });
  function fillAndSubmit({ title = '', desc = '', priority = 'medium' } = {}) {
    document.getElementById('task-title').value    = title;
    document.getElementById('task-desc').value     = desc;
    document.getElementById('task-priority').value = priority;
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }
  test('calls fetch POST with correct title, description and priority', async () => {
    fillAndSubmit({ title: 'New Mission', desc: 'explore the stars', priority: 'high' });
    await flushPromises();
    const postCall = fetch.mock.calls.find(([, opts]) => opts && opts.method === 'POST');
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall[1].body);
    expect(body.title).toBe('New Mission');
    expect(body.description).toBe('explore the stars');
    expect(body.priority).toBe('high');
  });
  test('resets the title field after successful submit', async () => {
    fillAndSubmit({ title: 'Mission Alpha' });
    await flushPromises();
    expect(document.getElementById('task-title').value).toBe('');
  });
  test('resets priority back to medium after submit', async () => {
    fillAndSubmit({ title: 'High prio task', priority: 'high' });
    await flushPromises();
    expect(document.getElementById('task-priority').value).toBe('medium');
  });
  test('does not call fetch POST when title is empty', async () => {
    fillAndSubmit({ title: '' });
    await flushPromises();
    expect(fetch.mock.calls.find(([, opts]) => opts && opts.method === 'POST')).toBeUndefined();
  });
  test('does not call fetch POST when title is only whitespace', async () => {
    fillAndSubmit({ title: '   ' });
    await flushPromises();
    expect(fetch.mock.calls.find(([, opts]) => opts && opts.method === 'POST')).toBeUndefined();
  });
  test('sends trimmed title', async () => {
    fillAndSubmit({ title: '  Padded Title  ' });
    await flushPromises();
    const postCall = fetch.mock.calls.find(([, opts]) => opts && opts.method === 'POST');
    expect(JSON.parse(postCall[1].body).title).toBe('Padded Title');
  });
});
