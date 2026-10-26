// SPDX-License-Identifier: AGPL-3.0-or-later
// 翼掠惊鸿 - 主控层

// ==================== 全局错误捕获 ====================

window.addEventListener('error', function (e) {
    try {
        var box = document.getElementById('fatal-error');
        if (!box) {
            box = document.createElement('div');
            box.id = 'fatal-error';
            box.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
                'background:#dc2626;color:#fff;font-size:12px;padding:8px 14px;' +
                'font-family:monospace;word-break:break-all;line-height:1.5;';
            document.body.appendChild(box);
        }
        box.textContent = 'JS 错误: ' + (e.message || '') +
            ' @ ' + (e.filename || '').split('/').pop() + ':' + (e.lineno || '');
    } catch (err) {}
});

// ==================== 游戏状态 ====================

let gameState = {
    money: 1000000000,
    fleet: [],
    transactions: [], // 财务流水，最多100条
    loans: []         // 贷款列表
};

let airlineInfo = {
    name: '翼掠航空',
    nameEn: 'Winged Air',
    code: 'WE'
};

let todayStats = { date: '', flights: 0, revenue: 0 };
let airlineReputation = 50;
let airportStates = {};

// 二手市场数据（由 world.js 里的逻辑生成和维护）
let secondhandMarket = [];

let overlayZCounter = 100;
let currentSaveId = null;
let pendingDelId = null;

// 上次发工资的绝对月份 (Year * 12 + Month)
let lastPayrollAbsMonth = null;

// 贷款系统状态
let currentLoanTerm = 12;
const LOAN_RATES = {
    12: 0.0080, // 0.80%
    24: 0.0060, // 0.60%
    36: 0.0040  // 0.40%
};

// ==================== 工具函数 ====================

function updateMoneyDisplay() {
    const yi = gameState.money / 100000000;
    document.getElementById('money-value').textContent = yi.toFixed(2);
}

function formatMoneyShort(n) {
    const absN = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (absN >= 100000000) return sign + '¥' + (absN / 100000000).toFixed(2) + '亿';
    if (absN >= 10000) return sign + '¥' + (absN / 10000).toFixed(2) + '万';
    return sign + '¥' + Math.round(absN);
}

// 全局资金变动函数
function changeMoney(amount, desc) {
    gameState.money += amount;
    
    if (Math.abs(amount) >= 500000) {
        const now = new Date(gameTimeMs);
        const timeStr = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
        
        gameState.transactions.unshift({
            time: timeStr,
            desc: desc || '未知交易',
            amount: amount
        });
        
        if (gameState.transactions.length > 100) {
            gameState.transactions.pop();
        }
    }
    
    updateMoneyDisplay();
    renderAirlinePanel();
}

function countFleetByType(type) {
    return gameState.fleet.filter(function (p) { return p.type === type; }).length;
}

function routeExists(fromIata, toIata) {
    return routes.some(function (r) { return r.from === fromIata && r.to === toIata; });
}

function pad2(n) { return String(n).padStart(2, '0'); }

function fmtMin(totalMin) {
    const h = Math.floor(totalMin / 60);
    const m = Math.round(totalMin % 60);
    if (h === 0) return m + 'min';
    if (m === 0) return h + 'h';
    return h + 'h ' + m + 'min';
}

function fmtTimeOfDay(totalMin) {
    const h = Math.floor(totalMin / 60) % 24;
    const m = Math.floor(totalMin % 60);
    return pad2(h) + ':' + pad2(m);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// ==================== 声誉 ====================

function formatReputation(rep) {
    if (rep >= 100) return '100%';
    return rep.toFixed(2) + '%';
}

function getReputationColorClass(rep) {
    if (rep < 20) return 'rep-red';
    if (rep < 40) return 'rep-orange';
    if (rep < 60) return 'rep-yellow';
    if (rep < 80) return 'rep-lime';
    return 'rep-green';
}

function addReputation(delta) {
    if (airlineReputation >= 100) return;
    airlineReputation = Math.min(100, airlineReputation + delta);
    renderAirlinePanel();
}

// ==================== 员工与工资计算 ====================

function getStaffCount() {
    let staff = 70; // 总部固定

    Object.values(airportStates).forEach(function(state) {
        if (state === 'open') staff += 30;
        else if (state === 'hub') staff += 50;
        else if (state === 'branch') staff += 100;
        else if (state === 'subbase') staff += 160;
        else if (state === 'hq') staff += 240;
    });

    gameState.fleet.forEach(function(plane) {
        const ac = getAircraftData(plane.type);
        const cat = ac.wakeCategory;
        if (cat === 'M') staff += 20;
        else if (cat === 'H') staff += 35;
        else if (cat === 'J') staff += 45;
    });

    return staff;
}

function getMonthlySalary() {
    return getStaffCount() * 25000;
}

function getTotalMonthlyLoan() {
    let total = 0;
    gameState.loans.forEach(l => total += l.monthlyPayment);
    return total;
}

function getTotalDebt() {
    let total = 0;
    gameState.loans.forEach(l => total += l.remainingPrincipal);
    return total;
}

function processPayroll() {
    let salary = getMonthlySalary();
    let totalLoan = getTotalMonthlyLoan();
    let totalDeduct = salary + totalLoan;

    if (gameState.money < totalDeduct) {
        triggerBankrupt();
        return;
    }

    // 扣除工资
    changeMoney(-salary, '发放员工工资');
    
    // 扣除贷款月供
    if (totalLoan > 0) {
        changeMoney(-totalLoan, '扣除贷款月供');
        // 处理贷款期数递减
        for (let i = gameState.loans.length - 1; i >= 0; i--) {
            let loan = gameState.loans[i];
            loan.monthsLeft--;
            loan.remainingPrincipal -= (loan.monthlyPayment - loan.remainingPrincipal * loan.rate); // 粗略扣减剩余本金
            if (loan.monthsLeft <= 0) {
                gameState.loans.splice(i, 1);
            }
        }
        showToast('本月工资及贷款已扣除 · -¥' + formatMoneyShort(totalDeduct));
    } else {
        showToast('本月工资已发放 · -¥' + formatMoneyShort(salary));
    }
}

function triggerBankrupt() {
    gamePaused = true;
    updateSpeedButtons();
    openOverlay('bankrupt-overlay');
}

function confirmBankrupt() {
    closeOverlay('bankrupt-overlay');

    if (typeof closePlaneDetail === 'function') closePlaneDetail();
    if (typeof clearAllRoutes === 'function') clearAllRoutes();
    if (typeof clearAllPlaneMarkers === 'function') clearAllPlaneMarkers();

    gameState.money = 1000000000;
    gameState.fleet = [];
    gameState.transactions = [];
    gameState.loans = [];
    airportStates = {};
    secondhandMarket = [];

    airlineInfo.name = '翼掠航空';
    airlineInfo.nameEn = 'Winged Air';
    airlineInfo.code = 'WE';
    airlineReputation = 50;
    currentSaveId = null;
    lastPayrollAbsMonth = null;

    todayStats.date = '';
    todayStats.flights = 0;
    todayStats.revenue = 0;

    startTimeSystem();

    document.getElementById('game-page').classList.remove('active');
    document.getElementById('start-page').style.display = '';

    document.querySelectorAll('.overlay.active').forEach(function (el) {
        el.classList.remove('active');
    });
    refreshOverlayDim();

    if (typeof refreshAllAirportDots === 'function') refreshAllAirportDots();
    if (typeof renderFleet === 'function') renderFleet();
    if (typeof renderRouteTab === 'function') renderRouteTab();
    renderAirlinePanel();

    if (typeof bgAnimating !== 'undefined') {
        bgAnimating = true;
        requestAnimationFrame(bgLoop);
    }
}

// ==================== 左侧面板渲染 ====================

function renderAirlinePanel() {
    const nameEl = document.getElementById('lp-name');
    const nameEnEl = document.getElementById('lp-name-en');
    const codeEl = document.getElementById('lp-code');

    if (nameEl) nameEl.textContent = airlineInfo.name;
    if (nameEnEl) nameEnEl.textContent = (airlineInfo.nameEn || '').toUpperCase();
    if (codeEl) codeEl.textContent = airlineInfo.code;

    const fleetEl = document.getElementById('lp-fleet');
    const routesEl = document.getElementById('lp-routes');
    const activeEl = document.getElementById('lp-active');

    if (fleetEl) fleetEl.textContent = gameState.fleet.length + ' 架';
    if (routesEl) routesEl.textContent = routes.length + ' 条';

    const activeCount = gameState.fleet.filter(function (p) {
        return !!p.schedule && !p.pendingCheck && !(p.maintenanceUntilMs > 0);
    }).length;
    if (activeEl) activeEl.textContent = activeCount + ' 架';

    // 员工与工资
    const staffCount = getStaffCount();
    const salary = getMonthlySalary();
    const staffEl = document.getElementById('lp-staff');
    const salaryEl = document.getElementById('lp-salary');
    if (staffEl) staffEl.textContent = staffCount + ' 人';
    if (salaryEl) salaryEl.textContent = '-¥' + formatMoneyShort(salary).replace('¥', '');

    // 负债与月供
    const debtEl = document.getElementById('lp-debt');
    const monthlyEl = document.getElementById('lp-monthly');
    if (debtEl) debtEl.textContent = '-¥' + formatMoneyShort(getTotalDebt()).replace('¥', '');
    if (monthlyEl) monthlyEl.textContent = '-¥' + formatMoneyShort(getTotalMonthlyLoan()).replace('¥', '');

    const todayFlightsEl = document.getElementById('lp-today-flights');
    const todayRevenueEl = document.getElementById('lp-today-revenue');

    if (todayFlightsEl) todayFlightsEl.textContent = todayStats.flights + ' 班';
    if (todayRevenueEl) {
        todayRevenueEl.textContent = '¥' + formatMoneyShort(todayStats.revenue).replace('¥', '');
    }

    const repEl = document.getElementById('lp-reputation');
    if (repEl) {
        repEl.textContent = formatReputation(airlineReputation);
        repEl.className = 'lp-val ' + getReputationColorClass(airlineReputation);
    }
}

// ==================== 财务面板与贷款逻辑 ====================

function openFinancePanel() {
    renderFinancePanel();
    openOverlay('finance-overlay');
}

function closeFinancePanel() {
    closeOverlay('finance-overlay');
}

function renderFinancePanel() {
    const listEl = document.getElementById('finance-list');
    let totalIn = 0;
    let totalOut = 0;
    let html = '';

    gameState.transactions.forEach(tx => {
        const isIncome = tx.amount > 0;
        const amtStr = (isIncome ? '+' : '') + '¥' + formatMoneyShort(tx.amount).replace('¥', '');
        
        if (isIncome) totalIn += tx.amount;
        else totalOut += Math.abs(tx.amount);

        html += `
            <div class="fl-row">
                <div class="fl-left">
                    <span class="fl-desc">${escapeHtml(tx.desc)}</span>
                    <span class="fl-time">${tx.time}</span>
                </div>
                <div class="fl-amount ${isIncome ? 'income' : 'expense'}">${amtStr}</div>
            </div>
        `;
    });

    if (gameState.transactions.length === 0) {
        html = '<div class="save-empty">暂无大额流水</div>';
    }
    listEl.innerHTML = html;

    document.getElementById('finance-total-income').textContent = '¥' + formatMoneyShort(totalIn).replace('¥', '');
    document.getElementById('finance-total-expense').textContent = '¥' + formatMoneyShort(totalOut).replace('¥', '');
    document.getElementById('finance-total-balance').textContent = '¥' + formatMoneyShort(gameState.money).replace('¥', '');
}

function showLoanPanel() {
    // 计算最高额度
    const maxAmt = 10 + 90 * (airlineReputation / 100);
    document.getElementById('loan-max-label').textContent = `当前最高可借：${maxAmt.toFixed(2)} 亿`;
    document.getElementById('loan-amount-slider').max = maxAmt;
    
    let currentVal = parseFloat(document.getElementById('loan-amount-input').value);
    if (isNaN(currentVal) || currentVal > maxAmt) {
        currentVal = maxAmt;
        document.getElementById('loan-amount-input').value = maxAmt.toFixed(2);
        document.getElementById('loan-amount-slider').value = maxAmt;
    }
    
    closeFinancePanel();
    updateLoanPreview();
    openOverlay('loan-overlay');
}

function closeLoanPanel() {
    closeOverlay('loan-overlay');
    openFinancePanel();
}

function onAmountInput(val) {
    let v = val.replace(/[^\d.]/g, '');
    const parts = v.split('.');
    if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
    document.getElementById('loan-amount-input').value = v;
    
    let num = parseFloat(v);
    let maxAmt = parseFloat(document.getElementById('loan-amount-slider').max);
    if (!isNaN(num)) {
        if (num > maxAmt) num = maxAmt;
        document.getElementById('loan-amount-slider').value = num;
        updateLoanPreview();
    }
}

function syncLoanFromSlider(val) {
    let v = parseFloat(val);
    document.getElementById('loan-amount-input').value = v.toFixed(2);
    updateLoanPreview();
}

document.getElementById('loan-amount-input').addEventListener('blur', function() {
    let v = parseFloat(this.value);
    let maxAmt = parseFloat(document.getElementById('loan-amount-slider').max);
    if (isNaN(v) || v <= 0) v = 0.01;
    if (v > maxAmt) v = maxAmt;
    this.value = v.toFixed(2);
    document.getElementById('loan-amount-slider').value = v;
    updateLoanPreview();
});

function setLoanTerm(term) {
    currentLoanTerm = term;
    document.querySelectorAll('.term-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.term) === term);
    });
    updateLoanPreview();
}

function updateLoanPreview() {
    let principalYi = parseFloat(document.getElementById('loan-amount-input').value);
    if (isNaN(principalYi) || principalYi <= 0) principalYi = 0;
    
    const principal = principalYi * 100000000;
    const r = LOAN_RATES[currentLoanTerm];
    const n = currentLoanTerm;

    let monthly = 0;
    let interest = 0;
    if (principal > 0) {
        monthly = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
        const totalRepay = monthly * n;
        interest = totalRepay - principal;
    }

    document.getElementById('lp-principal').textContent = principalYi.toFixed(2) + ' 亿';
    document.getElementById('lp-rate').textContent = (r * 100).toFixed(2) + '%';
    document.getElementById('lp-monthly').textContent = '¥ ' + (monthly / 100000000).toFixed(2) + ' 亿';
    document.getElementById('lp-interest').textContent = '¥ ' + (interest / 100000000).toFixed(2) + ' 亿';
}

function confirmLoan() {
    let principalYi = parseFloat(document.getElementById('loan-amount-input').value);
    if (isNaN(principalYi) || principalYi <= 0) return;
    
    const principal = principalYi * 100000000;
    const r = LOAN_RATES[currentLoanTerm];
    const n = currentLoanTerm;
    
    const monthly = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);

    gameState.loans.push({
        principal: principal,
        remainingPrincipal: principal,
        rate: r,
        totalMonths: n,
        monthsLeft: n,
        monthlyPayment: monthly
    });

    changeMoney(principal, '银行批款');
    
    showToast('贷款已到账 · +¥' + formatMoneyShort(principal).replace('¥', ''));
    closeLoanPanel();
}

function getTodayDateStr() {
    const d = new Date(gameTimeMs);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function checkTodayReset() {
    const cur = getTodayDateStr();
    if (todayStats.date !== cur) {
        todayStats.date = cur;
        todayStats.flights = 0;
        todayStats.revenue = 0;
        renderAirlinePanel();
    }
}

function addTodayFlight(amount) {
    checkTodayReset();
    todayStats.flights += 1;
    if (amount && amount > 0) {
        todayStats.revenue += amount;
    }
    renderAirlinePanel();
}

// ==================== 航司信息修改 ====================

function openAirlineEdit() {
    const nameInput = document.getElementById('ae-name');
    const nameEnInput = document.getElementById('ae-name-en');
    const codeInput = document.getElementById('ae-code');

    nameInput.value = airlineInfo.name;
    nameEnInput.value = airlineInfo.nameEn;
    codeInput.value = airlineInfo.code;

    nameInput.classList.remove('error');
    nameEnInput.classList.remove('error');
    codeInput.classList.remove('error');
    document.getElementById('ae-hint-name').classList.remove('error');
    document.getElementById('ae-hint-name-en').classList.remove('error');
    document.getElementById('ae-hint-code').classList.remove('error');

    document.getElementById('ae-hint-name').textContent = '1 ~ 8 个字';
    document.getElementById('ae-hint-name-en').textContent = '0 ~ 20 个字符';
    document.getElementById('ae-hint-code').textContent = '第一位：数字或字母 · 第二位：字母';

    document.getElementById('ae-save-btn').disabled = false;

    openOverlay('airline-edit-overlay');
    setTimeout(function () {
        nameInput.focus();
        nameInput.select();
    }, 100);
}

function closeAirlineEdit() {
    closeOverlay('airline-edit-overlay');
}

function validateAirlineEdit() {
    let ok = true;

    const nameInput = document.getElementById('ae-name');
    const nameHint = document.getElementById('ae-hint-name');
    const nameVal = nameInput.value.trim();

    if (nameVal.length < 1 || nameVal.length > 8) {
        nameInput.classList.add('error');
        nameHint.classList.add('error');
        nameHint.textContent = '名称需 1 ~ 8 个字';
        ok = false;
    } else {
        nameInput.classList.remove('error');
        nameHint.classList.remove('error');
        nameHint.textContent = '1 ~ 8 个字';
    }

    const codeInput = document.getElementById('ae-code');
    const codeHint = document.getElementById('ae-hint-code');
    const codeVal = codeInput.value.toUpperCase();

    if (!/^[0-9A-Z][A-Z]$/.test(codeVal)) {
        codeInput.classList.add('error');
        codeHint.classList.add('error');
        codeHint.textContent = '格式：第一位数字或字母，第二位字母';
        ok = false;
    } else {
        codeInput.classList.remove('error');
        codeHint.classList.remove('error');
        codeHint.textContent = '第一位：数字或字母 · 第二位：字母';
    }

    document.getElementById('ae-save-btn').disabled = !ok;
    return ok;
}

function saveAirlineEdit(btn) {
    if (btn && btn.disabled) return;
    if (!validateAirlineEdit()) return;

    airlineInfo.name = document.getElementById('ae-name').value.trim();
    airlineInfo.nameEn = document.getElementById('ae-name-en').value.trim();
    airlineInfo.code = document.getElementById('ae-code').value.toUpperCase();

    closeAirlineEdit();
    renderAirlinePanel();
    renderFlightList();
    showToast('航司信息已更新');
}

// ==================== 弹窗管理 ====================

function getOverlayContainer() {
    const gamePage = document.getElementById('game-page');
    if (gamePage && gamePage.classList.contains('active')) {
        return document.querySelector('.main-area');
    }
    return document.getElementById('start-page');
}

function openOverlay(id) {
    const el = document.getElementById(id);

    if (el.classList.contains('overlay--dynamic')) {
        const container = getOverlayContainer();
        if (container && el.parentNode !== container) {
            container.appendChild(el);
        }
    }

    el.style.zIndex = overlayZCounter++;
    el.classList.add('active');
    refreshOverlayDim();
}

function closeOverlay(id) {
    document.getElementById(id).classList.remove('active');
    refreshOverlayDim();
}

function refreshOverlayDim() {
    const actives = Array.prototype.slice.call(
        document.querySelectorAll('.overlay.active, .buy-dim.active')
    );

    actives.sort(function (a, b) {
        return (parseInt(a.style.zIndex) || 0) - (parseInt(b.style.zIndex) || 0);
    });

    actives.forEach(function (el, idx) {
        if (idx === 0) {
            el.classList.remove('no-dim');
        } else {
            el.classList.add('no-dim');
        }
    });
}

// ==================== Toast ====================

let toastTimer = null;
function showToast(text) {
    const toast = document.getElementById('toast');
    toast.textContent = text;
    toast.classList.add('show');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
        toast.classList.remove('show');
    }, 2000);
}

let startToastTimer = null;
function showStartToast(text) {
    const toast = document.getElementById('start-toast');
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('show');

    clearTimeout(startToastTimer);
    startToastTimer = setTimeout(function () {
        toast.classList.remove('show');
    }, 2000);
}

// ==================== 启动页背景地图 ====================

let bgMap = null;
let bgAnimating = false;
let bgPlanes = [];
let bgShift = 0;

function initBackgroundMap() {
    const container = document.getElementById('bg-map');
    if (!container || bgMap) return;

    bgMap = L.map('bg-map', {
        center: [35.0, 105.0],
        zoom: 5,
        minZoom: 5,
        maxZoom: 5,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
        tap: false,
        worldCopyJump: false,
        maxBounds: [[-85, -180], [85, 180]],
        maxBoundsViscosity: 0.8
    });

    L.tileLayer(
        'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
        { subdomains: '1234', minZoom: 5, maxZoom: 5, noWrap: true }
    ).addTo(bgMap);

    bgMap.invalidateSize();

    AIRPORT_GCJ.forEach(function (a) {
        L.circleMarker([a.lat, a.lng], {
            radius: 3.5, fillColor: '#1a3a5c', color: '#ffffff', weight: 1, fillOpacity: 1, interactive: false
        }).addTo(bgMap);
    });

    DEMO_ROUTES.forEach(function (pair, idx) {
        const a = AIRPORT_GCJ[pair[0]];
        const b = AIRPORT_GCJ[pair[1]];
        const pts = makeArc(a, b, 60);

        L.polyline(pts, { color: '#2563eb', weight: 1.5, opacity: 0.55, interactive: false }).addTo(bgMap);

        const marker = L.marker(pts[0], { icon: makePlaneIcon(), interactive: false }).addTo(bgMap);

        bgPlanes.push({ marker: marker, points: pts, progress: idx * 0.25, speed: 0.0015 + Math.random() * 0.0008, lastAngle: null });
    });

    bgAnimating = true;
    requestAnimationFrame(bgLoop);
}

function bgLoop() {
    if (!bgAnimating || !bgMap) return;

    bgShift += 0.0018;
    const lngOffset = Math.cos(bgShift) * 9;
    const latOffset = Math.sin(bgShift) * 5;
    bgMap.setView([35.0 + latOffset, 105.0 + lngOffset], 5, { animate: false });

    bgPlanes.forEach(function (p) {
        p.progress += p.speed;
        if (p.progress > 1) p.progress = 0;

        const idx = p.progress * (p.points.length - 1);
        const i0 = Math.floor(idx);
        const i1 = Math.min(i0 + 1, p.points.length - 1);
        const frac = idx - i0;

        const lat = p.points[i0][0] + (p.points[i1][0] - p.points[i0][0]) * frac;
        const lng = p.points[i0][1] + (p.points[i1][1] - p.points[i0][1]) * frac;

        p.marker.setLatLng([lat, lng]);

        const dLat = p.points[i1][0] - p.points[i0][0];
        const dLng = p.points[i1][1] - p.points[i0][1];

        let angle = Math.atan2(-dLat, dLng) * 180 / PI + 90;

        if (p.lastAngle !== null) {
            while (angle - p.lastAngle > 180) angle -= 360;
            while (angle - p.lastAngle < -180) angle += 360;
        }
        p.lastAngle = angle;

        const el = p.marker.getElement();
        if (el) {
            const rot = el.querySelector('.plane-rot');
            if (rot) rot.style.transform = 'rotate(' + angle + 'deg)';
        }
    });

    requestAnimationFrame(bgLoop);
}

// ==================== 页面交互 ====================

function bootGame(loadData, saveId) {
    bgAnimating = false;
    currentSaveId = saveId || null;

    document.getElementById('start-page').style.display = 'none';
    document.getElementById('game-page').classList.add('active');

    if (loadData) {
        gameState.money = loadData.money;
        gameState.transactions = loadData.transactions || [];
        gameState.loans = loadData.loans || [];
        
        gameState.fleet = (loadData.fleet || []).map(function (p) {
            const ac = getAircraftData(p.type);
            let cabin = p.cabin;
            if (!cabin) {
                cabin = { P: 0, F: 0, C: 0, W: 0, Y: ac.maxRows };
            }

            return {
                name: p.name, 
                type: p.type, 
                home: p.home, 
                cabin: cabin,
                schedule: p.schedule || null,
                purchaseTimeMs: p.purchaseTimeMs || GAME_START_MS,
                totalFh: p.totalFh || 0, 
                nextACheckFh: p.nextACheckFh || 300,
                nextCCheckFh: p.nextCCheckFh || 3000, 
                nextDCheckFh: p.nextDCheckFh || 10000,
                maintenanceUntilMs: p.maintenanceUntilMs || 0, 
                pendingCheck: p.pendingCheck || null,
                lastCheckLevel: null, 
                _marker: null, 
                _state: null
            };
        });

        if (loadData.airline) {
            airlineInfo.name = loadData.airline.name || airlineInfo.name;
            airlineInfo.nameEn = loadData.airline.nameEn || '';
            airlineInfo.code = loadData.airline.code || 'WE';
        }

        if (loadData.reputation !== undefined) airlineReputation = loadData.reputation;
        else airlineReputation = 50;

        if (loadData.todayStats) {
            todayStats.date = loadData.todayStats.date || '';
            todayStats.flights = loadData.todayStats.flights || 0;
            todayStats.revenue = loadData.todayStats.revenue || 0;
        }

        airportStates = loadData.airportStates || {};
        gameState.fleet.forEach(function (p) {
            if (p.home) airportStates[p.home] = 'branch';
        });

        if (loadData.secondhandMarket) {
            secondhandMarket = loadData.secondhandMarket;
        } else {
            if (typeof initSecondhandMarket === 'function') initSecondhandMarket(loadData);
        }

    } else {
        gameState.transactions = [];
        gameState.loans = [];
        airportStates = {};
        gameState.fleet = [];
        gameState.money = 1000000000;
        if (typeof initSecondhandMarket === 'function') initSecondhandMarket(null);
    }

    updateMoneyDisplay();
    renderFleet();
    renderFlightList();
    renderRouteTab();
    renderAirportTab();
    renderAirlinePanel();

    setTimeout(function () {
        initGameMap();
        if (gameMap) gameMap.invalidateSize();

        if (loadData) {
            clearAllRoutes();
            (loadData.routes || []).forEach(function (r) {
                const from = AIRPORT_GCJ.find(function (a) { return a.iata === r.from; });
                const to = AIRPORT_GCJ.find(function (a) { return a.iata === r.to; });
                if (from && to) drawRoute(from, to, true);
            });
            startTimeSystem(loadData.gameTimeMs, loadData.gameSpeed, loadData.gamePaused);
            gameMap.setView([35.0, 105.0], 4);
        } else {
            startTimeSystem();
        }

        let d = new Date(gameTimeMs);
        lastPayrollAbsMonth = d.getFullYear() * 12 + d.getMonth();

        refreshAllAirportDots();
        rebuildAllPlaneMarkers();
        updatePlanesPosition();
        renderRouteTab();
        renderAirlinePanel();
    }, 100);
}

function enterGame(btn) {
    if (btn.classList.contains('pressed')) return;
    btn.classList.add('pressed');
    setTimeout(function () {
        btn.classList.remove('pressed');
        bootGame();
    }, 200);
}

function startPageLoad(btn) {
    if (btn.classList.contains('pressed')) return;
    btn.classList.add('pressed');
    setTimeout(function () {
        btn.classList.remove('pressed');
        openSaveList();
    }, 200);
}

function openAbout(btn) {
    if (btn.classList.contains('pressed')) return;
    btn.classList.add('pressed');
    setTimeout(function () {
        btn.classList.remove('pressed');
        document.getElementById('about-page').classList.add('active');
    }, 200);
}

function closeAbout(btn) {
    if (btn.classList.contains('pressed')) return;
    btn.classList.add('pressed');
    setTimeout(function () {
        btn.classList.remove('pressed');
        document.getElementById('about-page').classList.remove('active');
    }, 200);
}

function switchTab(tabEl, contentId) {
    document.querySelectorAll('.right-panel .tab').forEach(function (t) { t.classList.remove('active'); });
    tabEl.classList.add('active');
    document.querySelectorAll('.right-panel .panel-content').forEach(function (p) { p.classList.remove('active'); });
    document.getElementById(contentId).classList.add('active');
}

// ==================== 时间系统 ====================

const GAME_START_MS = new Date(2027, 0, 1, 0, 0, 0).getTime();
let gameTimeMs = GAME_START_MS;
let gameSpeed = 1;
let gamePaused = true;
let lastTickReal = 0;
let timeLoopId = null;

function formatGameTime(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
           pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function renderTimeDisplay() {
    const el = document.getElementById('time-display');
    if (el) el.textContent = formatGameTime(gameTimeMs);
}

function timeLoop(now) {
    if (!lastTickReal) lastTickReal = now;
    const realDelta = now - lastTickReal;
    lastTickReal = now;

    if (!gamePaused) {
        gameTimeMs += realDelta * gameSpeed;
        renderTimeDisplay();
        updatePlanesPosition();
        checkTodayReset();

        if (lastPayrollAbsMonth !== null) {
            let d = new Date(gameTimeMs);
            let currentAbsMonth = d.getFullYear() * 12 + d.getMonth();

            while (lastPayrollAbsMonth < currentAbsMonth) {
                lastPayrollAbsMonth++;
                processPayroll();
                if (gamePaused) break;

                if (typeof onMonthChangeForMarket === 'function') {
                    onMonthChangeForMarket();
                }
            }
        }
    }

    timeLoopId = requestAnimationFrame(timeLoop);
}

function startTimeSystem(initMs, initSpeed, initPaused) {
    gameTimeMs = (initMs !== undefined) ? initMs : GAME_START_MS;
    gameSpeed = (initSpeed !== undefined) ? initSpeed : 1;
    gamePaused = (initPaused !== undefined) ? initPaused : true;

    lastTickReal = 0;
    renderTimeDisplay();
    updateSpeedButtons();

    if (timeLoopId) cancelAnimationFrame(timeLoopId);
    timeLoopId = requestAnimationFrame(timeLoop);
}

function setGameSpeed(speed) {
    gameSpeed = speed;
    if (gamePaused) gamePaused = false;

    var hideIt = (speed === 360000);
    var mainArea = document.querySelector('.main-area');
    var flightList = document.getElementById('flight-list');
    if (mainArea) mainArea.classList.toggle('hide-planes', hideIt);
    if (flightList) flightList.classList.toggle('hide-events', hideIt);

    updateSpeedButtons();
}

function togglePause() {
    gamePaused = !gamePaused;
    lastTickReal = 0;
    updateSpeedButtons();
}

function updateSpeedButtons() {
    document.querySelectorAll('.speed-seg[data-speed]').forEach(function (b) {
        const s = parseInt(b.dataset.speed, 10);
        b.classList.toggle('active', !gamePaused && s === gameSpeed);
    });

    const pauseBtn = document.getElementById('pause-btn');
    if (pauseBtn) {
        pauseBtn.textContent = gamePaused ? '▶ 开始' : '⏸ 暂停';
        pauseBtn.classList.toggle('active', gamePaused);
    }
}

// ==================== 存档系统 ====================

const SAVES_KEY = 'wingedEcho.saves.v1';
const SAVE_VERSION = 10;

function getAllSaves() {
    const raw = localStorage.getItem(SAVES_KEY);
    if (!raw) return [];
    try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr.filter(function (s) { return s && s.version === SAVE_VERSION && s.data; });
    } catch (e) { return []; }
}

function writeAllSaves(arr) {
    try {
        localStorage.setItem(SAVES_KEY, JSON.stringify(arr));
        return true;
    } catch (e) { return false; }
}

function hasAnySave() { return getAllSaves().length > 0; }
function getSaveById(id) { return getAllSaves().find(function (s) { return s.id === id; }) || null; }

function buildSaveData() {
    return {
        gameTimeMs: gameTimeMs,
        money: gameState.money,
        transactions: gameState.transactions,
        loans: gameState.loans,
        airline: { name: airlineInfo.name, nameEn: airlineInfo.nameEn, code: airlineInfo.code },
        reputation: airlineReputation,
        todayStats: { date: todayStats.date, flights: todayStats.flights, revenue: todayStats.revenue },
        fleet: gameState.fleet.map(function (p) {
            return {
                name: p.name, 
                type: p.type, 
                home: p.home, 
                cabin: p.cabin,
                schedule: p.schedule || null,
                purchaseTimeMs: p.purchaseTimeMs || GAME_START_MS,
                totalFh: p.totalFh || 0, 
                nextACheckFh: p.nextACheckFh || 300,
                nextCCheckFh: p.nextCCheckFh || 3000, 
                nextDCheckFh: p.nextDCheckFh || 10000,
                maintenanceUntilMs: p.maintenanceUntilMs || 0, 
                pendingCheck: p.pendingCheck || null
            };
        }),
        routes: routes.map(function (r) { return { from: r.from, to: r.to }; }),
        airportStates: airportStates,
        secondhandMarket: secondhandMarket,
        gameSpeed: gameSpeed,
        gamePaused: gamePaused
    };
}

function saveGame() {
    if (currentSaveId === null) { openSaveNaming(); return; }
    const allSaves = getAllSaves();
    const idx = allSaves.findIndex(function (s) { return s.id === currentSaveId; });
    if (idx < 0) { currentSaveId = null; openSaveNaming(); return; }
    allSaves[idx].savedAt = Date.now();
    allSaves[idx].data = buildSaveData();
    if (writeAllSaves(allSaves)) showToast('已存档');
    else showToast('存档失败');
}

function openSaveNaming() {
    const input = document.getElementById('save-naming-input');
    input.value = '';
    input.classList.remove('error');
    const hint = document.getElementById('save-naming-hint');
    hint.textContent = '1 ~ 12 个字，不可重复';
    hint.classList.remove('error');
    document.getElementById('save-naming-confirm-btn').disabled = true;
    openOverlay('save-naming-overlay');
    setTimeout(function () { input.focus(); }, 100);
}

function closeSaveNaming() { closeOverlay('save-naming-overlay'); }

function validateSaveNaming() {
    const input = document.getElementById('save-naming-input');
    const hint = document.getElementById('save-naming-hint');
    const btn = document.getElementById('save-naming-confirm-btn');
    const name = input.value.trim();
    input.classList.remove('error');
    hint.classList.remove('error');
    if (name.length === 0) { hint.textContent = '1 ~ 12 个字，不可重复'; btn.disabled = true; return false; }
    if (name.length > 12) { input.classList.add('error'); hint.classList.add('error'); hint.textContent = '最多 12 个字'; btn.disabled = true; return false; }
    const dup = getAllSaves().some(function (s) { return s.saveName === name; });
    if (dup) { input.classList.add('error'); hint.classList.add('error'); hint.textContent = '存档名已存在'; btn.disabled = true; return false; }
    hint.textContent = '1 ~ 12 个字，不可重复';
    btn.disabled = false;
    return true;
}

function confirmSaveNaming(btn) {
    if (btn.disabled) return;
    if (!validateSaveNaming()) return;
    const input = document.getElementById('save-naming-input');
    const name = input.value.trim();
    const allSaves = getAllSaves();
    const id = Date.now();
    allSaves.push({ version: SAVE_VERSION, id: id, saveName: name, named: true, savedAt: Date.now(), data: buildSaveData() });
    if (!writeAllSaves(allSaves)) { showToast('存档失败'); return; }
    currentSaveId = id;
    closeSaveNaming();
    showToast('已存档');
}

function fmtSavedAgo(ms) {
    const diff = Date.now() - ms;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 172800000) return '昨天';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
    const d = new Date(ms);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

function openSaveList() { renderSaveListContent(); openOverlay('save-list-overlay'); }
function closeSaveList() { closeOverlay('save-list-overlay'); }

function renderSaveListContent() {
    const body = document.getElementById('save-list-body');
    const allSaves = getAllSaves().sort(function (a, b) { return b.savedAt - a.savedAt; });
    if (allSaves.length === 0) { body.innerHTML = '<div class="save-empty">暂无存档</div>'; return; }
    let html = '';
    allSaves.forEach(function (s) {
        const d = s.data;
        const gameTime = formatGameTime(d.gameTimeMs);
        const moneyYi = (d.money / 100000000).toFixed(2);
        const savedAgo = fmtSavedAgo(s.savedAt);
        const airlineName = (d.airline && d.airline.name) || '—';
        html +=
            '<div class="save-card">' +
                '<div class="sc-name">' + escapeHtml(s.saveName) + '</div>' +
                '<div class="sc-airline">' + escapeHtml(airlineName) + '</div>' +
                '<div class="sc-time">' + gameTime + '</div>' +
                '<div class="sc-meta">¥<b>' + moneyYi + '</b>亿<span class="dot">·</span>存档于 ' + savedAgo + '</div>' +
                '<div class="sc-actions">' +
                    '<button class="sc-btn export" onclick="exportSave(' + s.id + ')">导出</button>' +
                    '<button class="sc-btn load" onclick="doLoadSave(' + s.id + ')">读取</button>' +
                    '<button class="sc-btn del" onclick="openDelConfirm(' + s.id + ')">删除</button>' +
                '</div>' +
            '</div>';
    });
    body.innerHTML = html;
}

function doLoadSave(id) {
    const save = getSaveById(id);
    if (!save) return;
    closeSaveList();
    const inGame = document.getElementById('game-page').classList.contains('active');
    if (inGame) {
        currentSaveId = id;
        applySaveData(save.data);
        showToast('已读档');
    } else {
        bootGame(save.data, id);
    }
}

function applySaveData(data) {
    if (!gameMap) return;
    if (typeof closePlaneDetail === 'function') closePlaneDetail();

    gameState.money = data.money;
    gameState.transactions = data.transactions || [];
    gameState.loans = data.loans || [];
    
    gameState.fleet = (data.fleet || []).map(function (p) {
        const ac = getAircraftData(p.type);
        let cabin = p.cabin;
        if (!cabin) {
            cabin = { P: 0, F: 0, C: 0, W: 0, Y: ac.maxRows };
        }

        return {
            name: p.name, 
            type: p.type, 
            home: p.home, 
            cabin: cabin,
            schedule: p.schedule || null,
            purchaseTimeMs: p.purchaseTimeMs || GAME_START_MS,
            totalFh: p.totalFh || 0, 
            nextACheckFh: p.nextACheckFh || 300,
            nextCCheckFh: p.nextCCheckFh || 3000, 
            nextDCheckFh: p.nextDCheckFh || 10000,
            maintenanceUntilMs: p.maintenanceUntilMs || 0, 
            pendingCheck: p.pendingCheck || null,
            lastCheckLevel: null, 
            _marker: null, 
            _state: null
        };
    });

    if (data.airline) {
        airlineInfo.name = data.airline.name || '翼掠航空';
        airlineInfo.nameEn = data.airline.nameEn || '';
        airlineInfo.code = data.airline.code || 'WE';
    }

    if (data.reputation !== undefined) airlineReputation = data.reputation;
    else airlineReputation = 50;

    if (data.todayStats) {
        todayStats.date = data.todayStats.date || '';
        todayStats.flights = data.todayStats.flights || 0;
        todayStats.revenue = data.todayStats.revenue || 0;
    }

    airportStates = data.airportStates || {};
    gameState.fleet.forEach(function (p) {
        if (p.home) airportStates[p.home] = 'branch';
    });

    secondhandMarket = data.secondhandMarket || [];
    if (secondhandMarket.length === 0 && typeof initSecondhandMarket === 'function') {
        initSecondhandMarket(data);
    }

    updateMoneyDisplay();
    renderFleet();
    renderAirlinePanel();

    clearAllRoutes();
    (data.routes || []).forEach(function (r) {
        const from = AIRPORT_GCJ.find(function (a) { return a.iata === r.from; });
        const to = AIRPORT_GCJ.find(function (a) { return a.iata === r.to; });
        if (from && to) drawRoute(from, to, true);
    });

    refreshAllAirportDots();
    rebuildAllPlaneMarkers();

    startTimeSystem(data.gameTimeMs, data.gameSpeed, data.gamePaused);
    gameMap.setView([35.0, 105.0], 4);

    let d = new Date(gameTimeMs);
    lastPayrollAbsMonth = d.getFullYear() * 12 + d.getMonth();

    updatePlanesPosition();
    renderRouteTab();
    renderAirportTab();
    renderFlightList();
}

function openDelConfirm(id) {
    const save = getSaveById(id);
    if (!save) return;
    pendingDelId = id;
    document.getElementById('del-confirm-name').textContent = save.saveName;
    openOverlay('save-del-confirm-overlay');
}

function closeDelConfirm() { closeOverlay('save-del-confirm-overlay'); pendingDelId = null; }

function goDelVerify() {
    if (pendingDelId === null) return;
    const save = getSaveById(pendingDelId);
    if (!save) { closeDelConfirm(); return; }
    closeOverlay('save-del-confirm-overlay');
    const moneyYi = (save.data.money / 100000000).toFixed(2);
    document.getElementById('del-verify-money').innerHTML = moneyYi + '<span class="unit">亿</span>';
    const input = document.getElementById('del-verify-input');
    input.value = '';
    input.classList.remove('error');
    const hint = document.getElementById('del-verify-hint');
    hint.textContent = '';
    hint.classList.remove('error');
    openOverlay('save-del-verify-overlay');
    setTimeout(function () { input.focus(); }, 100);
}

function closeDelVerify() { closeOverlay('save-del-verify-overlay'); pendingDelId = null; }

function confirmDelSave() {
    if (pendingDelId === null) return;
    const save = getSaveById(pendingDelId);
    if (!save) { closeDelVerify(); return; }
    const input = document.getElementById('del-verify-input');
    const hint = document.getElementById('del-verify-hint');
    const numInput = parseFloat(input.value.trim());
    const numTarget = save.data.money / 100000000;
    if (isNaN(numInput) || Math.abs(numInput - numTarget) > 0.001) {
        input.classList.add('error');
        hint.textContent = '金额不正确';
        hint.classList.add('error');
        input.focus();
        input.select();
        return;
    }
    const newSaves = getAllSaves().filter(function (s) { return s.id !== pendingDelId; });
    if (!writeAllSaves(newSaves)) { showToast('删除失败'); return; }
    if (currentSaveId === pendingDelId) currentSaveId = null;
    pendingDelId = null;
    closeOverlay('save-del-verify-overlay');
    renderSaveListContent();
    showToast('存档已删除');
}

// ---------- 存档导出 / 导入 ----------

function getFormattedDateTime() {
    const d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + pad2(d.getHours()) + pad2(d.getMinutes());
}

function exportSave(id) {
    const save = getSaveById(id);
    if (!save) return;

    const jsonStr = JSON.stringify(save, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const safeName = save.saveName.replace(/[\\/:*?"<>|]/g, '_');
    const timeStr = getFormattedDateTime();
    
    const a = document.createElement('a');
    a.href = url;
    a.download = '翼掠惊鸿_' + safeName + '_' + timeStr + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function triggerImport() {
    document.getElementById('save-import-file').click();
}

function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const imported = JSON.parse(e.target.result);
            
            if (!imported || !imported.data || imported.version !== SAVE_VERSION) {
                showToast('导入失败：文件版本不兼容或已损坏');
                return;
            }

            const allSaves = getAllSaves();
            let finalName = imported.saveName || '未命名存档';
            const baseName = finalName;
            let counter = 1;

            while (allSaves.some(s => s.saveName === finalName)) {
                finalName = baseName + ' (导入' + (counter > 1 ? ' ' + counter : '') + ')';
                counter++;
            }

            const newSave = {
                version: SAVE_VERSION,
                id: Date.now(),
                saveName: finalName,
                named: true,
                savedAt: Date.now(),
                data: imported.data
            };

            allSaves.push(newSave);
            if (writeAllSaves(allSaves)) {
                showToast('导入成功：' + finalName);
                renderSaveListContent();
            } else {
                showToast('导入失败：本地存储空间不足');
            }
        } catch (err) {
            console.error(err);
            showToast('导入失败：不是有效的 JSON 文件');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// ==================== 管理员调试 ====================

const ADMIN_PASSWORD = '676767';
const ADMIN_CLICK_TARGET = 9;
const ADMIN_CLICK_INTERVAL_MS = 1000;
let adminClickCount = 0;
let adminLastClickMs = 0;

function initAdminTrigger() {
    // 改到点击时间触发
    const el = document.getElementById('time-display');
    if (!el) return;
    el.addEventListener('click', onTimeDisplayClick);
}

function onTimeDisplayClick() {
    const now = Date.now();
    if (adminLastClickMs && (now - adminLastClickMs) <= ADMIN_CLICK_INTERVAL_MS) adminClickCount++;
    else adminClickCount = 1;
    adminLastClickMs = now;
    if (adminClickCount >= ADMIN_CLICK_TARGET) {
        adminClickCount = 0;
        adminLastClickMs = 0;
        openAdminPass();
    }
}

function openAdminPass() {
    const input = document.getElementById('admin-pass-input');
    input.value = '';
    input.classList.remove('error');
    openOverlay('admin-pass-overlay');
    setTimeout(function () { input.focus(); }, 100);
}

function closeAdminPass() { closeOverlay('admin-pass-overlay'); }

function submitAdminPass(btn) {
    if (btn.classList.contains('pressed')) return;
    btn.classList.add('pressed');
    setTimeout(function () {
        btn.classList.remove('pressed');
        const input = document.getElementById('admin-pass-input');
        const val = input.value.trim();
        if (val !== ADMIN_PASSWORD) {
            input.classList.add('error');
            input.focus();
            input.select();
            return;
        }
        closeAdminPass();
        openAdminMoney();
    }, 200);
}

function openAdminMoney() {
    const curYi = gameState.money / 100000000;
    document.getElementById('admin-current-money').textContent = curYi.toFixed(2);
    const input = document.getElementById('admin-money-input');
    input.value = curYi.toFixed(2);
    input.classList.remove('error');
    openOverlay('admin-money-overlay');
    setTimeout(function () { input.focus(); input.select(); }, 100);
}

function closeAdminMoney() { closeOverlay('admin-money-overlay'); }

function submitAdminMoney(btn) {
    if (btn.classList.contains('pressed')) return;
    btn.classList.add('pressed');
    setTimeout(function () {
        btn.classList.remove('pressed');
        const input = document.getElementById('admin-money-input');
        const val = parseFloat(input.value);
        if (isNaN(val) || val <= 0) {
            input.classList.add('error');
            input.focus();
            input.select();
            return;
        }
        const diff = Math.round(val * 100000000) - gameState.money;
        changeMoney(diff, '管理员调整资金');
        closeAdminMoney();
        showToast('资金已设置');
    }, 200);
}

// ==================== 初始化 ====================

function boot() {
    try { initBackgroundMap(); } catch (e) { console.error('背景地图初始化失败:', e); }
    try { initAdminTrigger(); } catch (e) { console.error('调试触发器初始化失败:', e); }

    const aeName = document.getElementById('ae-name');
    const aeNameEn = document.getElementById('ae-name-en');
    const aeCode = document.getElementById('ae-code');
    if (aeName) aeName.addEventListener('input', validateAirlineEdit);
    if (aeNameEn) aeNameEn.addEventListener('input', function () {});
    if (aeCode) {
        aeCode.addEventListener('input', function () {
            this.value = this.value.toUpperCase();
            validateAirlineEdit();
        });
    }

    const snInput = document.getElementById('save-naming-input');
    if (snInput) {
        snInput.addEventListener('input', validateSaveNaming);
        snInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const btn = document.getElementById('save-naming-confirm-btn');
                if (!btn.disabled) confirmSaveNaming(btn);
            }
        });
    }

    const dvInput = document.getElementById('del-verify-input');
    if (dvInput) {
        dvInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmDelSave();
            }
        });
    }

    window.addEventListener('resize', function () {
        try {
            if (bgMap) bgMap.invalidateSize();
            if (gameMap) gameMap.invalidateSize();
        } catch (e) {}
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 100); });
} else {
    setTimeout(boot, 100);
}
