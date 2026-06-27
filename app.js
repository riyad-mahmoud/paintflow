// ============================================================
// PaintFlow v2 — Core Application Logic
// Features: Workers, Projects, Attendance, Advances, Profile
// ============================================================

// ===== STATE =====
let state = {
    workers: [],
    attendance: {}, // { "YYYY-MM-DD": { "workerId": { status, rate, paymentId, projectId } } }
    payments: [], // { id, type("advance"|"settlement"), workerId, date, amountPaid, notes, settlementId? }
    projects: [], // { id, name, location, client, status }
    rates: { craftsman: 300, advanced_assistant: 200, assistant: 150 }
};

let currentWorkerFilter = 'all';
let currentAttendanceDate = '';
let currentProfileWorkerId = null;

// ===== TOAST =====
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show toast-${type}`;
    setTimeout(() => { toast.className = 'toast'; }, 3000);
}

// ===== DATE HELPERS — Fix for UTC bug =====
function getLocalDateString(date) {
    // Use local time, NOT toISOString() which can shift the date in UTC+X timezones
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function getTodayDateString() {
    return getLocalDateString(new Date());
}

function updateHeaderDate() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date-display').textContent =
        new Date().toLocaleDateString('ar-EG', options);
}

// ===== API STATE MANAGEMENT =====
async function loadState() {
    try {
        const [workers, projects, payments, settings] = await Promise.all([
            apiGet('/workers'),
            apiGet('/projects'),
            apiGet('/payments'),
            apiGet('/settings')
        ]);

        state.workers = workers.map(w => ({
            id: w.id, name: w.name, phone: w.phone,
            category: w.category, rate: Number(w.rate),
            isActive: w.is_active
        }));

        state.projects = projects.map(p => ({
            id: p.id, name: p.name,
            location: p.location, client: p.client,
            status: p.status
        }));

        state.payments = payments.map(p => ({
            id: p.id, type: p.type,
            workerId: p.worker_id, date: p.date.split('T')[0],
            amountPaid: Number(p.amount_paid),
            grossEarned: Number(p.gross_earned || 0),
            advancesPaid: Number(p.advances_paid || 0),
            daysCleared: Number(p.days_cleared || 0),
            notes: p.notes,
            settlementId: p.settlement_id
        }));

        state.rates = {
            craftsman: Number(settings.rate_craftsman || 300),
            advanced_assistant: Number(settings.rate_advanced_assistant || 200),
            assistant: Number(settings.rate_assistant || 150)
        };

        await loadAttendance();
        switchTab('dashboard');

    } catch (err) {
        console.error('Error loading state:', err);
        showToast('خطأ في الاتصال بالسيرفر', 'error');
    }
}

async function loadAttendance() {
    state.attendance = {};
    for (const w of state.workers) {
        const records = await apiGet(`/attendance/worker/${w.id}`);
        records.forEach(rec => {
            const date = rec.date.split('T')[0];
            if (!state.attendance[date]) state.attendance[date] = {};
            state.attendance[date][w.id] = {
                status: rec.status,
                rate: Number(rec.rate),
                paymentId: rec.payment_id,
                projectId: rec.project_id
            };
        });
    }
}

function saveStateToStorage() {
    // البيانات بتتحفظ في الـ backend — مش محتاجين localStorage
}
// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
    updateHeaderDate();
    currentAttendanceDate = getTodayDateString();
    document.getElementById('attendance-date-picker').value = currentAttendanceDate;
    await loadState();
});
// ===== TAB CONTROLLER =====
function switchTab(tabId) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navEl = document.getElementById(`nav-${tabId}`);
    if (navEl) navEl.classList.add('active');

    document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
    const panel = document.getElementById(`tab-${tabId}`);
    if (panel) panel.classList.add('active');

    // Clear search inputs on tab switch
    ['worker-search-input', 'attendance-search-input', 'payments-search-input'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    if (tabId === 'dashboard') renderDashboard();
    else if (tabId === 'workers') renderWorkers();
    else if (tabId === 'projects') renderProjects();
    else if (tabId === 'attendance') { updateProjectFilter(); renderAttendance(); }
    else if (tabId === 'payments') renderPayments();
    else if (tabId === 'settings') renderSettings();
}

// ===== FINANCIAL CALCULATION (CORE) =====
function calculateWorkerUnpaid(workerId) {
    let unpaidDays = 0;
    let unpaidHalfDays = 0;
    let grossEarned = 0;

    // Sum all un-settled attendance records
    for (const date in state.attendance) {
        const rec = state.attendance[date][workerId];
        if (rec && !rec.paymentId) {
            if (rec.status === 'full') {
                unpaidDays++;
                grossEarned += Number(rec.rate);
            } else if (rec.status === 'half') {
                unpaidHalfDays++;
                grossEarned += Number(rec.rate) * 0.5;
            }
        }
    }

    // Subtract pending advances (not yet linked to a settlement)
    const advancesPaid = state.payments
        .filter(p => p.workerId === workerId && p.type === 'advance' && !p.settlementId)
        .reduce((sum, p) => sum + Number(p.amountPaid), 0);

    const netBalance = Math.max(0, grossEarned - advancesPaid);

    return { unpaidDays, unpaidHalfDays, grossEarned, advancesPaid, netBalance, unpaidBalance: netBalance };
}

// ===== CATEGORY HELPERS =====
function getCategoryName(cat) {
    const map = { craftsman: 'صنايعي', advanced_assistant: 'مساعد متقدم', assistant: 'مساعد' };
    return map[cat] || 'عامل';
}

function getBadgeClass(cat) {
    const map = { craftsman: 'badge-craftsman', advanced_assistant: 'badge-advanced', assistant: 'badge-assistant' };
    return map[cat] || 'badge-assistant';
}

// ===== DASHBOARD =====
function renderDashboard() {
    const activeWorkers = state.workers.filter(w => w.isActive);
    document.getElementById('stat-active-workers').textContent = activeWorkers.length;

    let totalDue = 0;
    activeWorkers.forEach(w => { totalDue += calculateWorkerUnpaid(w.id).netBalance; });
    document.getElementById('stat-total-due').textContent = `${totalDue} ج.م`;

    const todayStr = getTodayDateString();
    let presentToday = 0;
    if (state.attendance[todayStr]) {
        for (const wId in state.attendance[todayStr]) {
            const a = state.attendance[todayStr][wId];
            if (a.status === 'full' || a.status === 'half') presentToday++;
        }
    }
    document.getElementById('stat-attendance-today').textContent = presentToday;

    renderWeeklySummary();

    // Worker financial summary cards
    const container = document.getElementById('dashboard-summary-list');
    container.innerHTML = '';

    if (activeWorkers.length === 0) {
        container.innerHTML = '<div class="empty-state">لا يوجد عمال مسجلين بعد. ابدأ بإضافة عامل.</div>';
        return;
    }

    activeWorkers.forEach(w => {
        const calc = calculateWorkerUnpaid(w.id);
        const card = document.createElement('div');
        card.className = 'worker-card clickable';
        card.onclick = () => showWorkerProfile(w.id);
        card.innerHTML = `
            <div class="worker-main">
                <div class="worker-avatar">👷‍♂️</div>
                <div class="worker-info">
                    <span class="worker-name">${escHtml(w.name)}</span>
                    <div class="worker-meta">
                        <span class="badge ${getBadgeClass(w.category)}">${getCategoryName(w.category)}</span>
                        <span class="worker-rate-text">${w.rate} ج.م/يوم</span>
                    </div>
                </div>
            </div>
            <div style="text-align:left;">
                <div class="text-orange" style="font-weight:800;font-size:1rem;">${calc.netBalance} ج.م</div>
                <div class="account-days-count">${calc.unpaidDays} يوم${calc.unpaidHalfDays > 0 ? ' | ' + calc.unpaidHalfDays + ' نصف' : ''}</div>
            </div>
        `;
        container.appendChild(card);
    });
}

// ===== WEEKLY SUMMARY =====
function renderWeeklySummary() {
    const grid = document.getElementById('weekly-grid');
    const statsText = document.getElementById('weekly-stats-text');
    if (!grid) return;

    grid.innerHTML = '';
    const dayNames = ['أحد', 'اثن', 'ثلث', 'أرب', 'خمس', 'جمع', 'سبت'];
    const today = new Date();
    let weekDays = 0, weekAmount = 0;

    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dateStr = getLocalDateString(d);
        const dayName = dayNames[d.getDay()];
        const dayData = state.attendance[dateStr] || {};

        let fullCount = 0, halfCount = 0;
        for (const wId in dayData) {
            const rec = dayData[wId];
            if (rec.status === 'full') { fullCount++; weekAmount += Number(rec.rate); weekDays += 1; }
            else if (rec.status === 'half') { halfCount++; weekAmount += Number(rec.rate) * 0.5; weekDays += 0.5; }
        }

        let dotClass = 'dot-empty', label = '—';
        const total = fullCount + halfCount;
        if (total > 0) {
            dotClass = fullCount >= halfCount ? 'dot-full' : 'dot-half';
            label = total;
        } else if (Object.keys(dayData).length > 0) {
            dotClass = 'dot-absent';
            label = '✗';
        }

        const isToday = dateStr === getLocalDateString(today);
        const cell = document.createElement('div');
        cell.className = `day-cell${isToday ? ' day-today' : ''}`;
        cell.innerHTML = `
            <div class="day-dot ${dotClass}">${label}</div>
            <div class="day-label">${dayName}</div>
        `;
        grid.appendChild(cell);
    }

    statsText.textContent = `${weekDays} يوم | ${weekAmount} ج.م`;
}

// ===== WORKERS =====
function renderWorkers() {
    const container = document.getElementById('workers-container');
    container.innerHTML = '';

    let filtered = state.workers.filter(w => w.isActive);
    if (currentWorkerFilter !== 'all') filtered = filtered.filter(w => w.category === currentWorkerFilter);

    const query = (document.getElementById('worker-search-input')?.value || '').trim().toLowerCase();
    if (query) filtered = filtered.filter(w => w.name.toLowerCase().includes(query));

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state">${query ? 'لا يوجد عمال يطابقون البحث.' : 'لا يوجد عمال في هذه الفئة.'}</div>`;
        return;
    }

    filtered.forEach(w => {
        const calc = calculateWorkerUnpaid(w.id);
        const card = document.createElement('div');
        card.className = 'worker-card';
        card.innerHTML = `
            <div class="worker-main" onclick="showWorkerProfile('${w.id}')" style="cursor:pointer;flex:1;">
                <div class="worker-avatar">👷‍♂️</div>
                <div class="worker-info">
                    <span class="worker-name">${escHtml(w.name)}</span>
                    <div class="worker-meta">
                        <span class="badge ${getBadgeClass(w.category)}">${getCategoryName(w.category)}</span>
                        <span class="worker-rate-text">${w.rate} ج.م/يوم</span>
                    </div>
                    <span style="font-size:0.68rem;color:var(--success);font-weight:700;">${calc.netBalance} ج.م مستحق</span>
                </div>
            </div>
            <div class="worker-actions">
                <button class="action-icon-btn" onclick="editWorker('${w.id}')" title="تعديل">✏️</button>
                <button class="action-icon-btn btn-delete" onclick="deleteWorker('${w.id}')" title="حذف">🗑️</button>
            </div>
        `;
        container.appendChild(card);
    });
}

function onWorkerSearch() { renderWorkers(); }

function filterWorkers(category, event) {
    currentWorkerFilter = category;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
    renderWorkers();
}

function showAddWorkerModal() {
    document.getElementById('worker-form').reset();
    document.getElementById('worker-id').value = '';
    document.getElementById('worker-modal-title').textContent = 'إضافة عامل جديد';
    updateDefaultRateHint();
    document.getElementById('worker-modal').classList.add('active');
}

function closeWorkerModal() {
    document.getElementById('worker-modal').classList.remove('active');
}

function updateDefaultRateHint() {
    const cat = document.getElementById('worker-category').value;
    const rate = state.rates[cat] || 0;
    document.getElementById('rate-hint').textContent = `اليومية الافتراضية للفئة: ${rate} ج.م`;
    if (!document.getElementById('worker-id').value) {
        document.getElementById('worker-rate').value = rate;
    }
}

async function saveWorker(event) {
    event.preventDefault();
    const id = document.getElementById('worker-id').value;
    const name = document.getElementById('worker-name').value.trim();
    const phone = document.getElementById('worker-phone').value.trim();
    const category = document.getElementById('worker-category').value;
    const rate = Number(document.getElementById('worker-rate').value);

    if (!name) return;

    if (id) {
        await apiPut(`/workers/${id}`, { name, phone, category, rate });
        showToast('تم تحديث بيانات العامل بنجاح');
    } else {
        const newId = 'w_' + Date.now();
        await apiPost('/workers', { id: newId, name, phone, category, rate });
        showToast('تم إضافة العامل الجديد بنجاح');
    }

    await loadState();
    closeWorkerModal();
}

function editWorker(workerId) {
    const w = state.workers.find(w => w.id === workerId);
    if (!w) return;
    document.getElementById('worker-id').value = w.id;
    document.getElementById('worker-name').value = w.name;
    document.getElementById('worker-phone').value = w.phone || '';
    document.getElementById('worker-category').value = w.category;
    document.getElementById('worker-rate').value = w.rate;
    document.getElementById('rate-hint').textContent = `اليومية الافتراضية للفئة: ${state.rates[w.category] || 0} ج.م`;
    document.getElementById('worker-modal-title').textContent = 'تعديل بيانات العامل';
    document.getElementById('worker-modal').classList.add('active');
}

async function deleteWorker(workerId) {
    const w = state.workers.find(w => w.id === workerId);
    if (!w) return;
    if (confirm(`هل أنت متأكد من حذف العامل "${w.name}"؟`)) {
        await apiDelete(`/workers/${workerId}`);
        await loadState();
        showToast('تم إزالة العامل من القائمة النشطة');
    }
}
// ===== PROJECTS =====
function renderProjects() {
    const container = document.getElementById('projects-container');
    container.innerHTML = '';

    if (state.projects.length === 0) {
        container.innerHTML = '<div class="empty-state">لا يوجد مشاريع مضافة. أضف أول موقع عمل.</div>';
        return;
    }

    state.projects.forEach(proj => {
        // Calculate project stats from attendance
        let totalDays = 0, totalCost = 0;
        const workerIds = new Set();

        for (const date in state.attendance) {
            for (const wId in state.attendance[date]) {
                const rec = state.attendance[date][wId];
                if (rec.projectId === proj.id) {
                    if (rec.status === 'full') { totalDays += 1; totalCost += Number(rec.rate); workerIds.add(wId); }
                    else if (rec.status === 'half') { totalDays += 0.5; totalCost += Number(rec.rate) * 0.5; workerIds.add(wId); }
                }
            }
        }

        const card = document.createElement('div');
        card.className = 'project-card';
        card.innerHTML = `
            <div class="project-card-header">
                <div class="project-icon">🏗️</div>
                <div class="project-info">
                    <div class="project-name">${escHtml(proj.name)}</div>
                    ${proj.location ? `<div class="project-meta">📍 ${escHtml(proj.location)}</div>` : ''}
                    ${proj.client ? `<div class="project-meta">👤 ${escHtml(proj.client)}</div>` : ''}
                </div>
                <div class="project-actions">
                    <button class="action-icon-btn" onclick="editProject('${proj.id}')" title="تعديل">✏️</button>
                    <button class="action-icon-btn btn-delete" onclick="deleteProject('${proj.id}')" title="حذف">🗑️</button>
                </div>
            </div>
            <div class="project-stats">
                <div class="project-stat">
                    <span class="project-stat-value">${workerIds.size}</span>
                    <span class="project-stat-label">عامل</span>
                </div>
                <div class="project-stat">
                    <span class="project-stat-value">${totalDays}</span>
                    <span class="project-stat-label">يوم عمل</span>
                </div>
                <div class="project-stat">
                    <span class="project-stat-value text-orange">${totalCost}</span>
                    <span class="project-stat-label">ج.م تكلفة</span>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function showAddProjectModal() {
    document.getElementById('project-form').reset();
    document.getElementById('project-id').value = '';
    document.getElementById('project-modal-title').textContent = 'إضافة موقع جديد';
    document.getElementById('project-modal').classList.add('active');
}

function closeProjectModal() {
    document.getElementById('project-modal').classList.remove('active');
}

async function saveProject(event) {
    event.preventDefault();
    const id = document.getElementById('project-id').value;
    const name = document.getElementById('project-name').value.trim();
    const location = document.getElementById('project-location').value.trim();
    const client = document.getElementById('project-client').value.trim();

    if (!name) return;

    if (id) {
        await apiPut(`/projects/${id}`, { name, location, client });
        showToast('تم تحديث بيانات الموقع');
    } else {
        const newId = 'proj_' + Date.now();
        await apiPost('/projects', { id: newId, name, location, client });
        showToast('تم إضافة الموقع الجديد بنجاح');
    }

    await loadState();
    closeProjectModal();
}

function editProject(projectId) {
    const proj = state.projects.find(p => p.id === projectId);
    if (!proj) return;
    document.getElementById('project-id').value = proj.id;
    document.getElementById('project-name').value = proj.name;
    document.getElementById('project-location').value = proj.location || '';
    document.getElementById('project-client').value = proj.client || '';
    document.getElementById('project-modal-title').textContent = 'تعديل بيانات الموقع';
    document.getElementById('project-modal').classList.add('active');
}

async function deleteProject(projectId) {
    const proj = state.projects.find(p => p.id === projectId);
    if (!proj) return;
    if (confirm(`هل تريد حذف الموقع "${proj.name}"؟`)) {
        await apiDelete(`/projects/${projectId}`);
        await loadState();
        showToast('تم حذف الموقع');
    }
}

// ===== ATTENDANCE =====
function updateProjectFilter() {
    const select = document.getElementById('attendance-project-filter');
    if (!select) return;
    const prev = select.value || 'all';
    select.innerHTML = '<option value="all">جميع المواقع</option>';
    state.projects.forEach(proj => {
        const opt = document.createElement('option');
        opt.value = proj.id;
        opt.textContent = proj.name;
        if (proj.id === prev) opt.selected = true;
        select.appendChild(opt);
    });
}

function onAttendanceProjectChange() { renderAttendance(); }
function onAttendanceSearch() { renderAttendance(); }

function renderAttendance() {
    document.getElementById('attendance-date-picker').value = currentAttendanceDate;

    const container = document.getElementById('attendance-container');
    container.innerHTML = '';

    let workers = state.workers.filter(w => w.isActive);

    const query = (document.getElementById('attendance-search-input')?.value || '').trim().toLowerCase();
    if (query) workers = workers.filter(w => w.name.toLowerCase().includes(query));

    if (workers.length === 0) {
        container.innerHTML = `<div class="empty-state">${query ? 'لا يوجد عمال يطابقون البحث.' : 'لا يوجد عمال نشطين.'}</div>`;
        document.getElementById('attendance-summary-text').textContent = 'الحضور اليوم: 0 عمال';
        return;
    }

    if (!state.attendance[currentAttendanceDate]) {
        state.attendance[currentAttendanceDate] = {};
    }

    const dayData = state.attendance[currentAttendanceDate];
    let present = 0;

    workers.forEach(w => {
        const rec = dayData[w.id];
        const status = rec ? rec.status : '';
        const isPaid = rec && rec.paymentId;
        const projName = rec?.projectId
            ? (state.projects.find(p => p.id === rec.projectId)?.name || '')
            : '';

        if (status === 'full' || status === 'half') present++;

        const card = document.createElement('div');
        card.className = 'attendance-card';
        card.innerHTML = `
            <div class="attendance-header">
                <div class="attendance-user">
                    <div class="worker-avatar" style="width:34px;height:34px;font-size:1rem;">👷‍♂️</div>
                    <div>
                        <div class="attendance-name">${escHtml(w.name)}</div>
                        ${projName ? `<div style="font-size:0.62rem;color:var(--text-muted);">📍 ${escHtml(projName)}</div>` : ''}
                    </div>
                </div>
                ${isPaid ? '<span class="badge badge-settlement">✓ مدفوع</span>' : ''}
            </div>
            <div class="attendance-options ${isPaid ? 'locked' : ''}">
                <button class="att-opt-btn ${status === 'full' ? 'active' : ''}" data-status="full"
                        onclick="toggleAttendance('${w.id}','full')"   ${isPaid ? 'disabled' : ''}>حاضر</button>
                <button class="att-opt-btn ${status === 'half' ? 'active' : ''}" data-status="half"
                        onclick="toggleAttendance('${w.id}','half')"   ${isPaid ? 'disabled' : ''}>نصف يوم</button>
                <button class="att-opt-btn ${status === 'absent' ? 'active' : ''}" data-status="absent"
                        onclick="toggleAttendance('${w.id}','absent')" ${isPaid ? 'disabled' : ''}>غائب</button>
            </div>
        `;
        container.appendChild(card);
    });

    document.getElementById('attendance-summary-text').textContent = `الحضور اليوم: ${present} عامل`;
}

async function toggleAttendance(workerId, newStatus) {
    const worker = state.workers.find(w => w.id === workerId);
    if (!worker) return;

    const dayData = state.attendance[currentAttendanceDate] || {};
    const current = dayData[workerId];

    const projFilter = document.getElementById('attendance-project-filter');
    const projectId = (projFilter && projFilter.value !== 'all') ? projFilter.value : null;

    if (current && current.status === newStatus) {
        await apiDelete(`/attendance/${workerId}/${currentAttendanceDate}`);
    } else {
        await apiPost('/attendance', {
            worker_id: workerId,
            project_id: projectId,
            date: currentAttendanceDate,
            status: newStatus,
            rate: worker.rate
        });
    }

    await loadAttendance();
    renderAttendance();
}

async function markAllPresent() {
    const workers = state.workers.filter(w => w.isActive);
    if (workers.length === 0) return;

    const projFilter = document.getElementById('attendance-project-filter');
    const projectId = (projFilter && projFilter.value !== 'all') ? projFilter.value : null;
    const dayData = state.attendance[currentAttendanceDate] || {};

    for (const w of workers) {
        if (!dayData[w.id] || !dayData[w.id].paymentId) {
            await apiPost('/attendance', {
                worker_id: w.id,
                project_id: projectId,
                date: currentAttendanceDate,
                status: 'full',
                rate: w.rate
            });
        }
    }

    await loadAttendance();
    renderAttendance();
    showToast('تم تسجيل حضور الجميع');
}
function adjustDate(offset) {
    const d = new Date(currentAttendanceDate);
    d.setDate(d.getDate() + offset);
    currentAttendanceDate = getLocalDateString(d);
    document.getElementById('attendance-date-picker').value = currentAttendanceDate;
    renderAttendance();
}

function onAttendanceDateChange() {
    const val = document.getElementById('attendance-date-picker').value;
    if (val) { currentAttendanceDate = val; renderAttendance(); }
}

// ===== PAYMENTS & PAYROLL =====
function onPaymentsSearch() { renderPayments(); }

function renderPayments() {
    const container = document.getElementById('accounts-container');
    container.innerHTML = '';

    let workers = state.workers.filter(w => w.isActive);
    const query = (document.getElementById('payments-search-input')?.value || '').trim().toLowerCase();
    if (query) workers = workers.filter(w => w.name.toLowerCase().includes(query));

    if (workers.length === 0) {
        container.innerHTML = `<div class="empty-state">${query ? 'لا يوجد عمال يطابقون البحث.' : 'لا يوجد عمال نشطين.'}</div>`;
    } else {
        workers.forEach(w => {
            const calc = calculateWorkerUnpaid(w.id);
            const card = document.createElement('div');
            card.className = 'account-card';
            card.innerHTML = `
                <div class="account-card-header">
                    <div class="worker-main" style="gap:10px;cursor:pointer;" onclick="showWorkerProfile('${w.id}')">
                        <div class="worker-avatar" style="width:40px;height:40px;font-size:1.1rem;">👷‍♂️</div>
                        <div class="worker-info">
                            <span class="worker-name">${escHtml(w.name)}</span>
                            <span class="account-days-count">${calc.unpaidDays} يوم كامل | ${calc.unpaidHalfDays} نصف يوم</span>
                        </div>
                    </div>
                    <div class="account-buttons">
                        <button class="btn btn-advance btn-sm" onclick="showAdvanceModal('${w.id}')">💸 سُلفة</button>
                        <button class="btn btn-success btn-sm"
                                onclick="settleAccount('${w.id}')"
                                ${calc.netBalance <= 0 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>
                            قبض
                        </button>
                    </div>
                </div>
                <div class="account-breakdown">
                    <div class="breakdown-row">
                        <span>المستحق الإجمالي:</span>
                        <span class="text-orange">${calc.grossEarned} ج.م</span>
                    </div>
                    ${calc.advancesPaid > 0 ? `
                    <div class="breakdown-row">
                        <span>السُلف المصروفة:</span>
                        <span class="text-danger">— ${calc.advancesPaid} ج.م</span>
                    </div>` : ''}
                    <div class="breakdown-row breakdown-total">
                        <span>الصافي المتبقي:</span>
                        <span class="text-green">${calc.netBalance} ج.م</span>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    }

    renderPaymentsHistory();
}

async function settleAccount(workerId) {
    const worker = state.workers.find(w => w.id === workerId);
    if (!worker) return;

    const calc = calculateWorkerUnpaid(workerId);
    if (calc.netBalance <= 0) return;

    let msg = `تصفية حساب "${worker.name}"\n`;
    msg += `المستحق الإجمالي: ${calc.grossEarned} ج.م\n`;
    if (calc.advancesPaid > 0) msg += `السُلف المصروفة: ${calc.advancesPaid} ج.م\n`;
    msg += `الصافي المستحق الدفع: ${calc.netBalance} ج.م\n\nهل تريد إتمام التصفية؟`;

    if (!confirm(msg)) return;

    const paymentId = 'pay_' + Date.now();
    const todayStr = getTodayDateString();

    await apiPost('/payments', {
        id: paymentId,
        type: 'settlement',
        worker_id: workerId,
        date: todayStr,
        amount_paid: calc.netBalance,
        gross_earned: calc.grossEarned,
        advances_paid: calc.advancesPaid,
        days_cleared: calc.unpaidDays + (calc.unpaidHalfDays * 0.5),
        notes: `تصفية ${calc.unpaidDays} يوم و ${calc.unpaidHalfDays} نصف يوم`,
        settlement_id: null
    });

    await apiPut(`/attendance/lock/${workerId}`, { payment_id: paymentId });
    await apiPut(`/payments/link-advances/${workerId}`, { settlement_id: paymentId });

    await loadState();
    renderPayments();
    showToast(`تمت التصفية بنجاح — ${calc.netBalance} ج.م لـ ${worker.name}`);
}

// Lock all unpaid attendance records
for (const date in state.attendance) {
    const rec = state.attendance[date][workerId];
    if (rec && !rec.paymentId) rec.paymentId = paymentId;
}

// Link pending advances to this settlement
state.payments.forEach(p => {
    if (p.workerId === workerId && p.type === 'advance' && !p.settlementId) {
        p.settlementId = paymentId;
    }
});

saveStateToStorage();
renderPayments();
showToast(`تمت التصفية بنجاح — ${calc.netBalance} ج.م لـ ${worker.name}`);


// ===== ADVANCE PAYMENTS (سُلف) =====
function showAdvanceModal(workerId) {
    const worker = state.workers.find(w => w.id === workerId);
    if (!worker) return;

    const calc = calculateWorkerUnpaid(workerId);

    document.getElementById('advance-worker-id').value = workerId;
    document.getElementById('advance-worker-name-display').textContent = worker.name;
    document.getElementById('advance-amount').value = '';
    document.getElementById('advance-notes').value = '';

    const balInfo = document.getElementById('advance-balance-info');
    balInfo.textContent = `المستحق الحالي: ${calc.grossEarned} ج.م${calc.advancesPaid > 0 ? ' | سُلف سابقة: ' + calc.advancesPaid + ' ج.م' : ''}`;

    document.getElementById('advance-modal').classList.add('active');
}

function closeAdvanceModal() {
    document.getElementById('advance-modal').classList.remove('active');
}
async function confirmPayAdvance() {
    const workerId = document.getElementById('advance-worker-id').value;
    const amount = Number(document.getElementById('advance-amount').value);
    const notes = document.getElementById('advance-notes').value.trim();

    if (!workerId || !amount || amount <= 0) {
        showToast('من فضلك أدخل مبلغ صحيح', 'error');
        return;
    }

    const worker = state.workers.find(w => w.id === workerId);
    const calc = calculateWorkerUnpaid(workerId);

    if (amount > calc.grossEarned) {
        showToast(`المبلغ أكبر من المستحق الإجمالي (${calc.grossEarned} ج.م)`, 'error');
        return;
    }

    await apiPost('/payments', {
        id: 'adv_' + Date.now(),
        type: 'advance',
        worker_id: workerId,
        date: getTodayDateString(),
        amount_paid: amount,
        gross_earned: null,
        advances_paid: null,
        days_cleared: null,
        notes: notes || 'سُلفة',
        settlement_id: null
    });

    await loadState();
    closeAdvanceModal();
    renderPayments();
    showToast(`تم صرف سُلفة ${amount} ج.م لـ ${worker.name}`);
}

function renderPaymentsHistory() {
    const container = document.getElementById('history-container');
    container.innerHTML = '';

    if (state.payments.length === 0) {
        container.innerHTML = '<div class="empty-state">لا يوجد دفعات وتصفيات مسجلة سابقاً.</div>';
        return;
    }

    state.payments.forEach(p => {
        const worker = state.workers.find(w => w.id === p.workerId);
        const name = worker ? worker.name : 'عامل محذوف';
        const dateStr = new Date(p.date + 'T00:00:00').toLocaleDateString('ar-EG', { year: 'numeric', month: 'numeric', day: 'numeric' });
        const isAdvance = p.type === 'advance';

        const card = document.createElement('div');
        card.className = 'history-card';
        card.innerHTML = `
            <div class="history-info">
                <div style="display:flex;gap:6px;align-items:center;">
                    <span class="badge ${isAdvance ? 'badge-advance' : 'badge-settlement'}">${isAdvance ? 'سُلفة' : 'تصفية'}</span>
                    <span class="history-worker">${escHtml(name)}</span>
                </div>
                <span class="history-meta">${dateStr} — ${escHtml(p.notes)}</span>
            </div>
            <span class="history-value ${isAdvance ? 'text-orange' : 'text-green'}">${p.amountPaid} ج.م</span>
        `;
        container.appendChild(card);
    });
}

// ===== WORKER PROFILE =====
function showWorkerProfile(workerId) {
    currentProfileWorkerId = workerId;
    const worker = state.workers.find(w => w.id === workerId);
    if (!worker) return;

    document.getElementById('profile-worker-name').textContent = worker.name;
    const badge = document.getElementById('profile-worker-badge');
    badge.textContent = getCategoryName(worker.category);
    badge.className = `badge ${getBadgeClass(worker.category)}`;

    // Reset to stats tab
    document.querySelectorAll('.profile-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.profile-tab-btn').classList.add('active');

    renderProfileStats(workerId);

    document.getElementById('worker-profile-modal').classList.add('active');
}

function closeWorkerProfile() {
    document.getElementById('worker-profile-modal').classList.remove('active');
    currentProfileWorkerId = null;
}

function switchProfileTab(tabId, btnEl) {
    document.querySelectorAll('.profile-tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.profile-tab-btn').forEach(el => el.classList.remove('active'));

    const panel = document.getElementById(`profile-tab-${tabId}`);
    if (panel) panel.classList.add('active');
    if (btnEl) btnEl.classList.add('active');

    if (!currentProfileWorkerId) return;

    if (tabId === 'stats') renderProfileStats(currentProfileWorkerId);
    else if (tabId === 'history') renderProfileHistory(currentProfileWorkerId);
    else if (tabId === 'payments_history') renderProfilePayments(currentProfileWorkerId);
}

function renderProfileStats(workerId) {
    const worker = state.workers.find(w => w.id === workerId);
    if (!worker) return;

    const calc = calculateWorkerUnpaid(workerId);

    const settlements = state.payments.filter(p => p.workerId === workerId && p.type === 'settlement');
    const totalPaidAllTime = settlements.reduce((s, p) => s + Number(p.amountPaid), 0);
    const totalAdvAllTime = state.payments
        .filter(p => p.workerId === workerId && p.type === 'advance')
        .reduce((s, p) => s + Number(p.amountPaid), 0);

    let totalDays = 0;
    for (const date in state.attendance) {
        const rec = state.attendance[date][workerId];
        if (rec) {
            if (rec.status === 'full') totalDays += 1;
            else if (rec.status === 'half') totalDays += 0.5;
        }
    }

    document.getElementById('profile-stats-content').innerHTML = `
        <div class="profile-stats-grid">
            <div class="profile-stat-card">
                <span class="profile-stat-value text-orange">${calc.netBalance} ج.م</span>
                <span class="profile-stat-label">الصافي المستحق الآن</span>
            </div>
            <div class="profile-stat-card">
                <span class="profile-stat-value">${calc.unpaidDays}</span>
                <span class="profile-stat-label">أيام غير مسددة</span>
            </div>
            <div class="profile-stat-card">
                <span class="profile-stat-value text-green">${totalPaidAllTime} ج.م</span>
                <span class="profile-stat-label">إجمالي المدفوع</span>
            </div>
            <div class="profile-stat-card">
                <span class="profile-stat-value">${totalDays}</span>
                <span class="profile-stat-label">إجمالي أيام العمل</span>
            </div>
        </div>
        <div class="profile-worker-details">
            <div class="detail-row"><span>الهاتف:</span><span>${worker.phone || 'غير مسجل'}</span></div>
            <div class="detail-row"><span>اليومية الحالية:</span><span>${worker.rate} ج.م</span></div>
            <div class="detail-row"><span>الفئة:</span><span>${getCategoryName(worker.category)}</span></div>
            ${calc.advancesPaid > 0 ? `<div class="detail-row"><span>سُلف معلقة:</span><span class="text-orange">${calc.advancesPaid} ج.م</span></div>` : ''}
            ${totalAdvAllTime > 0 ? `<div class="detail-row"><span>إجمالي السُلف (كل الوقت):</span><span>${totalAdvAllTime} ج.م</span></div>` : ''}
        </div>
    `;
}

function renderProfileHistory(workerId) {
    const container = document.getElementById('profile-history-content');
    container.innerHTML = '';

    const records = [];
    for (const date in state.attendance) {
        const rec = state.attendance[date][workerId];
        if (rec) records.push({ date, ...rec });
    }
    records.sort((a, b) => b.date.localeCompare(a.date));

    if (records.length === 0) {
        container.innerHTML = '<div class="empty-state">لا يوجد سجل حضور لهذا العامل.</div>';
        return;
    }

    records.slice(0, 30).forEach(rec => {
        const dateStr = new Date(rec.date + 'T00:00:00').toLocaleDateString('ar-EG', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
        const projName = rec.projectId ? (state.projects.find(p => p.id === rec.projectId)?.name || '') : '';
        const isPaid = rec.paymentId;

        let statusText = 'غائب', statusClass = 'text-danger', amount = 0;
        if (rec.status === 'full') { statusText = 'حاضر'; statusClass = 'text-green'; amount = rec.rate; }
        else if (rec.status === 'half') { statusText = 'نصف يوم'; statusClass = 'text-orange'; amount = rec.rate * 0.5; }

        const row = document.createElement('div');
        row.className = 'history-card';
        row.innerHTML = `
            <div class="history-info">
                <div style="display:flex;gap:5px;align-items:center;">
                    <span class="${statusClass}" style="font-weight:700;">${statusText}</span>
                    ${isPaid ? '<span class="badge badge-settlement" style="font-size:0.55rem;">مدفوع</span>' : ''}
                </div>
                <span class="history-meta">${dateStr}${projName ? ' — 📍 ' + projName : ''}</span>
            </div>
            <span style="font-weight:700;font-size:0.85rem;" class="${statusClass}">${amount > 0 ? amount + ' ج.م' : '—'}</span>
        `;
        container.appendChild(row);
    });
}

function renderProfilePayments(workerId) {
    const container = document.getElementById('profile-payments-content');
    container.innerHTML = '';

    const workerPayments = state.payments.filter(p => p.workerId === workerId);

    if (workerPayments.length === 0) {
        container.innerHTML = '<div class="empty-state">لا يوجد دفعات أو تصفيات لهذا العامل.</div>';
        return;
    }

    workerPayments.forEach(p => {
        const dateStr = new Date(p.date + 'T00:00:00').toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
        const isAdvance = p.type === 'advance';

        const row = document.createElement('div');
        row.className = 'history-card';
        row.innerHTML = `
            <div class="history-info">
                <div style="display:flex;gap:6px;align-items:center;">
                    <span class="badge ${isAdvance ? 'badge-advance' : 'badge-settlement'}">${isAdvance ? 'سُلفة' : 'تصفية'}</span>
                    <span style="font-size:0.78rem;">${escHtml(p.notes)}</span>
                </div>
                <span class="history-meta">${dateStr}</span>
            </div>
            <span class="history-value ${isAdvance ? 'text-orange' : 'text-green'}">${p.amountPaid} ج.م</span>
        `;
        container.appendChild(row);
    });
}

// ===== SETTINGS =====
function renderSettings() {
    document.getElementById('default-rate-craftsman').value = state.rates.craftsman;
    document.getElementById('default-rate-advanced').value = state.rates.advanced_assistant;
    document.getElementById('default-rate-assistant').value = state.rates.assistant;
}

async function saveDefaultRates(event) {
    event.preventDefault();
    const craftsman = document.getElementById('default-rate-craftsman').value;
    const advanced = document.getElementById('default-rate-advanced').value;
    const assistant = document.getElementById('default-rate-assistant').value;

    await apiPut('/settings/rate_craftsman', { value: craftsman });
    await apiPut('/settings/rate_advanced_assistant', { value: advanced });
    await apiPut('/settings/rate_assistant', { value: assistant });

    state.rates.craftsman = Number(craftsman);
    state.rates.advanced_assistant = Number(advanced);
    state.rates.assistant = Number(assistant);

    showToast('تم تحديث أسعار اليوميات الافتراضية');
}

async function exportData() {
    const data = {
        workers: state.workers,
        projects: state.projects,
        payments: state.payments,
        attendance: state.attendance,
        rates: state.rates
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paintflow_backup_${getTodayDateString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('تم تحميل ملف النسخة الاحتياطية');
}

async function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async e => {
        try {
            const imported = JSON.parse(e.target.result);
            if (imported.workers && imported.attendance && imported.payments) {
                if (confirm('استيراد هذا الملف سيستبدل جميع البيانات الحالية. هل تريد الاستمرار؟')) {
                    for (const w of imported.workers) {
                        await apiPost('/workers', {
                            id: w.id, name: w.name, phone: w.phone,
                            category: w.category, rate: w.rate
                        });
                    }
                    for (const p of imported.projects) {
                        await apiPost('/projects', {
                            id: p.id, name: p.name,
                            location: p.location, client: p.client
                        });
                    }
                    await loadState();
                    showToast('تم استعادة كافة البيانات بنجاح');
                    switchTab('dashboard');
                }
            } else {
                showToast('ملف غير صالح', 'error');
            }
        } catch (err) {
            showToast('فشل في قراءة الملف', 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

async function factoryReset() {
    if (confirm('⚠️ هذا سيحذف جميع البيانات نهائياً. هل أنت متأكد؟')) {
        for (const w of state.workers) {
            await apiDelete(`/workers/${w.id}`);
        }
        for (const p of state.projects) {
            await apiDelete(`/projects/${p.id}`);
        }
        await loadState();
        switchTab('dashboard');
        showToast('تم إعادة تعيين التطبيق');
    }
}

// ===== XSS PROTECTION: Sanitize text before innerHTML =====
function escHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
