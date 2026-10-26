// SPDX-License-Identifier: AGPL-3.0-or-later
// 翼掠惊鸿 - 世界层（地图 / 机场 / 航线 / 机队 / 飞行 / 时刻表 / 动态栏 / tab）

// ==================== 状态 ====================

let pendingAirport = null;
let selectedAirport = null;
let routePending = null;
let routes = [];
let gameMap = null;

const arcCache = {};

let selectedHomeIata = null;
let selectedAircraftType = null;

let editingSchedulePlaneIdx = -1;
let editingScheduleRouteKey = null;

let planeMarkers = [];
const flightEvents = [];
const FLIGHT_EVENT_MAX = 100;

let routePickerFrom = null;
let routePickerTo = null;

let homeSelectCtrl = null;
let rpFromSelectCtrl = null;
let rpToSelectCtrl = null;
let schRouteSelectCtrl = null;

let buyMode = 'card';
let buySource = 'new';
let buySortKey = 'mtow';
let buySortAsc = true;
let buySwitchLock = false;

let pendingSellIdx = -1;
let selectedUsedPlaneIdx = -1;

let apActionIata = null;
let apActionTarget = null;

let planeDetailIdx = -1;
let planeDetailTimer = null;

// 客舱配置相关
let currentCabinConfig = { P: 0, F: 0, C: 0, W: 0, Y: 0 };
let currentCabinMaxRows = 30;
let cabinHoldTimer = null;
let cabinHoldInterval = null;

// ==================== 定检常量 ====================

const CHECK_INTERVAL = { A: 300, C: 3000, D: 10000 };
const CHECK_COST_PCT = { A: 0.003, C: 0.02, D: 0.15 };
const CHECK_DOWNTIME_DAYS = { A: 1, C: 7, D: 30 };
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ==================== 工具 ====================

function parseHHMM(str) {
    if (!str) return null;
    const m = String(str).trim().match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const mi = parseInt(m[2], 10);
    if (h < 0 || h > 23) return null;
    if (mi < 0 || mi > 59) return null;
    return h * 60 + mi;
}

function minToHHMM(min) {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    return pad2(h) + ':' + pad2(m);
}

function getFlightNoBase(routeIdx) {
    return 1001 + routeIdx * 100;
}

function getRouteIndex(sched) {
    return routes.findIndex(function (r) {
        return r.from === sched.from && r.to === sched.to;
    });
}

function getFlightNo(sched, roundIdx, isReturn) {
    const idx = getRouteIndex(sched);
    if (idx < 0) return airlineInfo.code + '----';
    const num = getFlightNoBase(idx) + roundIdx * 2 + (isReturn ? 1 : 0);
    return airlineInfo.code + num;
}

function getDefaultPlaneName(type) {
    const ac = getAircraftData(type);
    return ac.displayName.replace(/^(空客|波音)\s*/, '');
}

// ---------- 机龄 & 残值 ----------

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;
const RESALE_DECAY = 0.94;

function getPlaneAgeYears(plane) {
    if (!plane || !plane.purchaseTimeMs) return 0;
    const age = (gameTimeMs - plane.purchaseTimeMs) / MS_PER_YEAR;
    return Math.max(0, age);
}

function formatPlaneAge(plane) {
    const age = getPlaneAgeYears(plane);
    if (age < 0.05) return '全新';
    return age.toFixed(1) + ' 年';
}

function getPlaneResaleValue(plane) {
    if (!plane) return 0;
    const ac = getAircraftData(plane.type);
    const age = getPlaneAgeYears(plane);
    return Math.round(ac.newPrice * Math.pow(RESALE_DECAY, age));
}

// ---------- 定检 ----------

function getCheckCost(plane, level) {
    var ac = getAircraftData(plane.type);
    return Math.round(ac.newPrice * CHECK_COST_PCT[level]);
}

function isUnderMaintenance(plane) {
    return !!plane.pendingCheck || plane.maintenanceUntilMs > 0;
}

function getNextCheckInfo(plane) {
    if (!plane) return null;

    var remainA = plane.nextACheckFh - plane.totalFh;
    var remainC = plane.nextCCheckFh - plane.totalFh;
    var remainD = plane.nextDCheckFh - plane.totalFh;

    if (remainD <= 0) return { level: 'D', remain: remainD };
    if (remainC <= 0) return { level: 'C', remain: remainC };
    if (remainA <= 0) return { level: 'A', remain: remainA };

    var level = 'A';
    var remain = remainA;
    if (remainC < remain) { remain = remainC; level = 'C'; }
    if (remainD < remain) { remain = remainD; level = 'D'; }

    return { level: level, remain: remain };
}

function accumulateFh(plane, hours) {
    if (!plane) return;

    plane.totalFh = (plane.totalFh || 0) + hours;

    if (plane.pendingCheck) return;
    if (plane.maintenanceUntilMs > 0) return;

    var remainA = plane.nextACheckFh - plane.totalFh;
    var remainC = plane.nextCCheckFh - plane.totalFh;
    var remainD = plane.nextDCheckFh - plane.totalFh;

    var level = null;
    if (remainD <= 0) level = 'D';
    else if (remainC <= 0) level = 'C';
    else if (remainA <= 0) level = 'A';

    if (level) {
        plane.pendingCheck = level;
        plane._state = null;

        pushFlightEvent({
            time: fmtTimeFromMs(gameTimeMs),
            flightNo: '',
            plane: plane.name,
            from: plane.home,
            to: plane.home,
            type: 'maint',
            level: level
        });

        renderFleet();
    }
}

function advanceCheckThresholds(plane, level) {
    var curFh = plane.totalFh;

    if (level === 'A') {
        plane.nextACheckFh += CHECK_INTERVAL.A;
    } else if (level === 'C') {
        plane.nextCCheckFh += CHECK_INTERVAL.C;
        plane.nextACheckFh = (Math.floor(curFh / CHECK_INTERVAL.A) + 1) * CHECK_INTERVAL.A;
    } else if (level === 'D') {
        plane.nextDCheckFh += CHECK_INTERVAL.D;
        plane.nextCCheckFh = (Math.floor(curFh / CHECK_INTERVAL.C) + 1) * CHECK_INTERVAL.C;
        plane.nextACheckFh = (Math.floor(curFh / CHECK_INTERVAL.A) + 1) * CHECK_INTERVAL.A;
    }
}

function startMaintenance(planeIdx) {
    var plane = gameState.fleet[planeIdx];
    if (!plane) return;
    if (!plane.pendingCheck) return;

    var level = plane.pendingCheck;
    var cost = getCheckCost(plane, level);

    if (gameState.money < cost) {
        showToast('资金不足');
        return;
    }

    changeMoney(-cost, `定检维修 (${plane.name})`);

    advanceCheckThresholds(plane, level);

    plane.maintenanceUntilMs = gameTimeMs + CHECK_DOWNTIME_DAYS[level] * MS_PER_DAY;
    plane.pendingCheck = null;

    var home = AIRPORT_GCJ.find(function (a) { return a.iata === plane.home; });
    if (home && plane._marker) {
        plane._marker.setLatLng([home.lat, home.lng]);
        setPlaneRotation(plane._marker, 0);
    }

    renderFleet();
    refreshPlaneDetailLive();

    showToast(plane.name + ' 已送检 · -¥' + formatMoneyShort(cost).replace('¥', ''));
}

function retirePlane(planeIdx) {
    var plane = gameState.fleet[planeIdx];
    if (!plane) return;
    if (plane.pendingCheck !== 'D') return;

    var value = Math.round(getPlaneResaleValue(plane) * 0.6);
    var planeName = plane.name;

    if (plane._marker) {
        if (gameMap) gameMap.removeLayer(plane._marker);
        var mi = planeMarkers.indexOf(plane._marker);
        if (mi >= 0) planeMarkers.splice(mi, 1);
    }

    gameState.fleet.splice(planeIdx, 1);
    changeMoney(value, `退役回收 (${planeName})`);

    closePlaneDetail();
    renderFleet();
    renderAirlinePanel();

    showToast('已退役 ' + planeName + ' · +¥' + formatMoneyShort(value).replace('¥', ''));
}

// ---------- 机场分级 ----------

function getAirportState(iata) {
    return airportStates[iata] || 'none';
}

function setAirportState(iata, state) {
    airportStates[iata] = state;
}

function isAirportOpen(iata) {
    var s = getAirportState(iata);
    return s === 'open' || s === 'hub' || s === 'branch' ||
           s === 'subbase' || s === 'hq';
}

function isAirportStation(iata) {
    var s = getAirportState(iata);
    return s === 'branch' || s === 'subbase' || s === 'hq';
}

function getAirportFee(airport, targetState) {
    var mult = 1;
    if (targetState === 'open') mult = 1;
    else if (targetState === 'hub') mult = 3;
    else if (targetState === 'branch') mult = 5;
    else if (targetState === 'subbase') mult = 10;
    else if (targetState === 'hq') mult = 20;
    return airport.throughput * 10000 * mult;
}

function getAirportStateName(state) {
    if (state === 'open') return '通航';
    if (state === 'hub') return '枢纽';
    if (state === 'branch') return '分公司';
    if (state === 'subbase') return '副基地';
    if (state === 'hq') return '基地';
    return '未通航';
}

function getAirportDotColor(iata) {
    var s = getAirportState(iata);
    if (s === 'open') return '#2b5ce6';
    if (s === 'hub') return '#16a34a';
    if (s === 'branch') return '#eab308';
    if (s === 'subbase') return '#f97316';
    if (s === 'hq') return '#dc2626';
    return '#555555';
}

function getNextAirportState(state) {
    if (state === 'none') return 'open';
    if (state === 'open') return 'hub';
    if (state === 'hub') return 'branch';
    if (state === 'branch') return 'subbase';
    if (state === 'subbase') return 'hq';
    return null;
}

// ---------- 客舱逻辑辅助 ----------

function getPlaneTotalSeats(plane) {
    if (!plane || !plane.cabin) return 0;
    const ac = getAircraftData(plane.type);
    let total = 0;
    for (let k in plane.cabin) {
        if (ac.seatsPerRow[k]) {
            total += plane.cabin[k] * ac.seatsPerRow[k];
        }
    }
    return total;
}

// ==================== 可搜索下拉 ====================

function createSearchSelect(config) {
    var inputEl = document.getElementById(config.inputId);
    var listEl = document.getElementById(config.listId);
    var triggerEl = document.getElementById(config.triggerId);

    if (!inputEl || !listEl || !triggerEl) {
        return {
            reset: function () {},
            setSelected: function () {},
            getSelectedKey: function () { return null; },
            close: function () {},
            isOpen: function () { return false; },
            getElement: function () { return null; }
        };
    }

    var selectedKey = null;
    var selectedText = '';
    var isOpen = false;

    function renderList(filter) {
        var items = config.getItems() || [];

        if (filter) {
            var f = filter.toLowerCase();
            items = items.filter(function (it) {
                return (it.searchText || '').toLowerCase().indexOf(f) >= 0;
            });
        }

        if (items.length === 0) {
            listEl.innerHTML = '<div class="cs-empty">' + config.emptyText + '</div>';
            return;
        }

        var html = '';
        items.forEach(function (it) {
            var cls = (it.key === selectedKey) ? ' cs-item-selected' : '';
            html +=
                '<div class="cs-item' + cls + '" data-key="' + it.key + '">' +
                    it.html +
                '</div>';
        });
        listEl.innerHTML = html;

        listEl.querySelectorAll('.cs-item').forEach(function (el) {
            el.onclick = function (e) {
                e.stopPropagation();
                selectItem(this.getAttribute('data-key'));
            };
        });
    }

    function selectItem(key) {
        var items = config.getItems() || [];
        var found = null;
        for (var i = 0; i < items.length; i++) {
            if (items[i].key === key) { found = items[i]; break; }
        }
        if (!found) return;

        selectedKey = key;
        selectedText = found.displayText;
        inputEl.value = selectedText;
        closeList();
        if (config.onSelect) config.onSelect(key);
    }

    function openList() {
        isOpen = true;
        triggerEl.classList.add('open');
        listEl.classList.add('open');
        renderList(inputEl.value.trim());
        if (config.onOpen) config.onOpen();
    }

    function closeList() {
        isOpen = false;
        triggerEl.classList.remove('open');
        listEl.classList.remove('open');
        if (selectedKey !== null) {
            inputEl.value = selectedText;
        } else {
            inputEl.value = '';
        }
    }

    inputEl.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isOpen) return;
        inputEl.value = '';
        openList();
    });

    inputEl.addEventListener('input', function () {
        if (!isOpen) {
            isOpen = true;
            triggerEl.classList.add('open');
            listEl.classList.add('open');
        }
        renderList(inputEl.value.trim());
    });

    return {
        reset: function () {
            selectedKey = null;
            selectedText = '';
            inputEl.value = '';
            closeList();
        },
        setSelected: function (key, text) {
            selectedKey = key;
            selectedText = text || '';
            inputEl.value = selectedText;
            closeList();
        },
        getSelectedKey: function () { return selectedKey; },
        close: closeList,
        isOpen: function () { return isOpen; },
        getElement: function () { return triggerEl.parentNode; }
    };
}

function getHomeAirportItems() {
    return AIRPORT_GCJ.filter(function (a) {
        return isAirportStation(a.iata);
    }).map(function (a) {
        return {
            key: a.iata,
            displayText: a.name + ' ' + a.iata,
            searchText: a.iata + ' ' + a.name + ' ' + a.city,
            html: '<span class="cs-item-name">' + a.name + '</span>' +
                  '<span class="cs-item-iata">' + a.iata + '</span>'
        };
    });
}

function getRouteAirportItems() {
    return AIRPORT_GCJ.filter(function (a) {
        return isAirportOpen(a.iata);
    }).map(function (a) {
        return {
            key: a.iata,
            displayText: a.name + ' ' + a.iata,
            searchText: a.iata + ' ' + a.name + ' ' + a.city,
            html: '<span class="cs-item-name">' + a.name + '</span>' +
                  '<span class="cs-item-iata">' + a.iata + '</span>'
        };
    });
}

function getScheduleRouteItems() {
    var plane = gameState.fleet[editingSchedulePlaneIdx];
    if (!plane) return [];

    var available = routes.filter(function (r) {
        return r.from === plane.home;
    });

    return available.map(function (r) {
        var a = AIRPORT_GCJ.find(function (x) { return x.iata === r.from; });
        var b = AIRPORT_GCJ.find(function (x) { return x.iata === r.to; });
        if (!a || !b) return null;

        var key = r.from + '-' + r.to;
        var label = a.name + ' ' + a.iata + ' → ' + b.name + ' ' + b.iata;

        return {
            key: key,
            displayText: label,
            searchText: r.from + ' ' + a.name + ' ' + a.city + ' ' +
                        r.to + ' ' + b.name + ' ' + b.city,
            html: label
        };
    }).filter(function (x) { return !!x; });
}

function initSearchSelects() {
    homeSelectCtrl = createSearchSelect({
        inputId: 'home-select-input',
        listId: 'home-select-list',
        triggerId: 'home-select-trigger',
        emptyText: '暂无分公司 / 基地',
        getItems: getHomeAirportItems,
        onSelect: function (iata) {
            selectedHomeIata = iata;
            updateNamingConfirmState();
        }
    });

    rpFromSelectCtrl = createSearchSelect({
        inputId: 'rp-from-input',
        listId: 'rp-from-list',
        triggerId: 'rp-from-trigger',
        emptyText: '暂无已通航机场',
        getItems: getRouteAirportItems,
        onSelect: function (iata) {
            routePickerFrom = iata;
            updateRoutePickerNextBtn();
        }
    });

    rpToSelectCtrl = createSearchSelect({
        inputId: 'rp-to-input',
        listId: 'rp-to-list',
        triggerId: 'rp-to-trigger',
        emptyText: '暂无已通航机场',
        getItems: getRouteAirportItems,
        onSelect: function (iata) {
            routePickerTo = iata;
            updateRoutePickerNextBtn();
        }
    });

    schRouteSelectCtrl = createSearchSelect({
        inputId: 'sch-route-input',
        listId: 'sch-route-list',
        triggerId: 'sch-route-trigger',
        emptyText: '暂无匹配航线',
        getItems: getScheduleRouteItems,
        onSelect: function (key) {
            editingScheduleRouteKey = key;
            document.getElementById('sch-flights-input').value = 1;
            updateScheduleUI();
        }
    });
}

// ==================== 航线运力 ====================

function calcRouteCapacity(fromIata, toIata) {
    let total = 0;
    gameState.fleet.forEach(function (plane) {
        if (!plane.schedule) return;
        if (isUnderMaintenance(plane)) return;
        const s = plane.schedule;
        const match = (s.from === fromIata && s.to === toIata) ||
                      (s.from === toIata && s.to === fromIata);
        if (!match) return;
        total += s.flightsPerDay * getPlaneTotalSeats(plane);
    });
    return total;
}

// ==================== 弧线生成 ====================

function makeArc(a, b, segments) {
    segments = segments || 60;
    const dLat = b.lat - a.lat;
    const dLng = b.lng - a.lng;
    const dist = Math.sqrt(dLat * dLat + dLng * dLng) || 1;

    const perpLat = -dLng / dist;
    const perpLng = dLat / dist;
    const bulge = dist * 0.22;

    const ctrlLat = (a.lat + b.lat) / 2 + perpLat * bulge;
    const ctrlLng = (a.lng + b.lng) / 2 + perpLng * bulge;

    const pts = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const it = 1 - t;
        const lat = it * it * a.lat + 2 * it * t * ctrlLat + t * t * b.lat;
        const lng = it * it * a.lng + 2 * it * t * ctrlLng + t * t * b.lng;
        pts.push([lat, lng]);
    }
    return pts;
}

function getArcPoints(fromIata, toIata) {
    const key = fromIata + '-' + toIata;
    if (!arcCache[key]) {
        const a = AIRPORT_GCJ.find(function (x) { return x.iata === fromIata; });
        const b = AIRPORT_GCJ.find(function (x) { return x.iata === toIata; });
        if (!a || !b) return null;
        arcCache[key] = makeArc(a, b, 60);
    }
    return arcCache[key];
}

function interpolateArc(pts, t) {
    const last = pts.length - 1;
    const idx = t * last;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, last);
    const frac = idx - i0;
    return {
        lat: pts[i0][0] + (pts[i1][0] - pts[i0][0]) * frac,
        lng: pts[i0][1] + (pts[i1][1] - pts[i0][1]) * frac
    };
}

function interpolateArcAngle(pts, t) {
    const last = pts.length - 1;
    const idx = t * last;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, last);
    const dLat = pts[i1][0] - pts[i0][0];
    const dLng = pts[i1][1] - pts[i0][1];
    return Math.atan2(-dLat, dLng) * 180 / PI + 90;
}

// ==================== 飞机图标 ====================

const PLANE_SVG_PATH = "M12 1 L13.5 9 L21 14 L21 15.5 L13.5 13 L13 18 L15 20 L15 21 L12 20 L9 21 L9 20 L11 18 L10.5 13 L3 15.5 L3 14 L10.5 9 Z";
const PLANE_ICON_SIZE = 32;

function makePlaneIcon() {
    return L.divIcon({
        className: 'plane-marker',
        html: '<div class="plane-rot">' +
                '<svg viewBox="0 0 24 24" width="' + PLANE_ICON_SIZE + '" height="' + PLANE_ICON_SIZE + '">' +
                    '<path fill="#2563eb" d="' + PLANE_SVG_PATH + '"/>' +
                '</svg>' +
              '</div>',
        iconSize: [PLANE_ICON_SIZE, PLANE_ICON_SIZE],
        iconAnchor: [PLANE_ICON_SIZE / 2, PLANE_ICON_SIZE / 2]
    });
}

// ==================== 飞行位置曲线 ====================

function calcFlightProgress(fromIata, toIata, aircraftType, elapsedMin) {
    const dur = calcFlightDuration(fromIata, toIata, aircraftType);
    if (!dur) return { t: 0, speed: 0 };

    const D = dur.distance;
    const flightMin = dur.flightMin;
    const accelTime = FLIGHT_CONSTANTS.ACCEL_TIME;
    const accelDist = FLIGHT_CONSTANTS.ACCEL_DIST;
    const accelSpeed = FLIGHT_CONSTANTS.ACCEL_SPEED;
    const cruiseSpeed = dur.cruiseSpeed;

    if (elapsedMin <= 0) return { t: 0, speed: 0 };
    if (elapsedMin >= flightMin) return { t: 1, speed: 0 };

    let pos, speed;

    if (elapsedMin < accelTime) {
        const a = accelSpeed / accelTime;
        pos = 0.5 * (a / 60) * elapsedMin * elapsedMin;
        speed = a * elapsedMin;
    } else if (elapsedMin < flightMin - accelTime) {
        const cruiseElapsed = elapsedMin - accelTime;
        pos = accelDist + cruiseElapsed * cruiseSpeed / 60;
        speed = cruiseSpeed;
    } else {
        const decelElapsed = elapsedMin - (flightMin - accelTime);
        const a = accelSpeed / accelTime;
        const decelStartPos = D - accelDist;
        pos = decelStartPos + decelElapsed * accelSpeed / 60 - 0.5 * (a / 60) * decelElapsed * decelElapsed;
        speed = accelSpeed - a * decelElapsed;
    }

    const t = Math.max(0, Math.min(1, pos / D));
    return { t: t, speed: Math.max(0, speed) };
}

// ==================== 游戏页地图 ====================

function initGameMap() {
    if (gameMap) return gameMap;

    gameMap = L.map('map', {
        center: [35.0, 105.0],
        zoom: 4,
        minZoom: 3,
        maxZoom: 18,
        zoomControl: false,
        attributionControl: true,
        tap: true,
        touchZoom: true,
        worldCopyJump: false,
        maxBounds: [[-85, -180], [85, 180]],
        maxBoundsViscosity: 0.8
    });

    gameMap.createPane('routeHitPane');
    gameMap.getPane('routeHitPane').style.zIndex = 390;

    L.tileLayer(
        'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
        {
            subdomains: '1234',
            attribution: '&copy; 高德地图',
            minZoom: 3,
            maxZoom: 18,
            noWrap: true
        }
    ).addTo(gameMap);

    L.control.zoom({ position: 'bottomright' }).addTo(gameMap);

    renderAirports(gameMap);

    gameMap.on('click', function () {
        closeAllPopupsAndClearState();
    });

    return gameMap;
}

function closeAllPopupsAndClearState() {
    AIRPORT_GCJ.forEach(function (a) {
        if (a._hotzone) {
            try { a._hotzone.closePopup(); } catch (e) {}
        }
    });

    if (pendingAirport) {
        pendingAirport = null;
    }

    if (selectedAirport) {
        setAirportSelected(selectedAirport, false);
        selectedAirport = null;
    }
}

function renderAirports(map) {
    AIRPORT_GCJ.forEach(function (airport) {
        const latlng = [airport.lat, airport.lng];

        const dot = L.circleMarker(latlng, {
            radius: 5,
            fillColor: getAirportDotColor(airport.iata),
            color: '#ffffff',
            weight: 1.5,
            opacity: 1,
            fillOpacity: 1,
            interactive: false
        }).addTo(map);

        const hotzone = L.circleMarker(latlng, {
            radius: 16,
            fillColor: '#000000',
            fillOpacity: 0,
            stroke: false,
            interactive: true
        }).addTo(map);

        hotzone.bindPopup(
            '<div style="font-size:13px;line-height:1.5;">' +
                '<div style="font-weight:bold;margin-bottom:6px;">' +
                    '<b>' + airport.iata + '</b> · ' + airport.name +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:10px;">' +
                    '<span style="color:#666;">' + airport.city + '</span>' +
                    '<button class="ap-panel-btn" onclick="openAirportPanel(\'' + airport.iata + '\')">面板 &gt;</button>' +
                '</div>' +
            '</div>',
            {
                closeButton: false,
                autoClose: false,
                closeOnClick: false,
                offset: [0, -8],
                maxWidth: 260
            }
        );

        airport._dot = dot;
        airport._hotzone = hotzone;

        hotzone.on('click', function (e) {
            L.DomEvent.stopPropagation(e);
            handleAirportClick(airport);
        });
    });
}

function refreshAllAirportDots() {
    AIRPORT_GCJ.forEach(function (airport) {
        if (!airport._dot) return;
        airport._dot.setStyle({ fillColor: getAirportDotColor(airport.iata) });
    });
}

function refreshAirportDot(iata) {
    var airport = AIRPORT_GCJ.find(function (a) { return a.iata === iata; });
    if (!airport || !airport._dot) return;
    airport._dot.setStyle({ fillColor: getAirportDotColor(iata) });
}

// ==================== 机场点击交互 ====================

function handleAirportClick(airport) {

    if (!isAirportOpen(airport.iata)) {
        showToast('该机场未通航，请到面板开通');
        return;
    }

    if (!pendingAirport && !selectedAirport) {
        pendingAirport = airport;
        airport._hotzone.openPopup();
        showToast('再点一次建立航线');
        return;
    }

    if (pendingAirport && pendingAirport.iata === airport.iata) {
        pendingAirport = null;
        selectedAirport = airport;
        setAirportSelected(airport, true);
        showToast('起点：' + airport.iata + ' · ' + airport.name);
        return;
    }

    if (pendingAirport && pendingAirport.iata !== airport.iata) {
        pendingAirport._hotzone.closePopup();
        pendingAirport = airport;
        airport._hotzone.openPopup();
        showToast('再点一次建立航线');
        return;
    }

    if (selectedAirport && selectedAirport.iata === airport.iata) {
        setAirportSelected(selectedAirport, false);
        selectedAirport = null;
        showToast('已取消起点');
        return;
    }

    if (selectedAirport && selectedAirport.iata !== airport.iata) {

        if (routeExists(selectedAirport.iata, airport.iata)) {
            setAirportSelected(selectedAirport, false);
            selectedAirport = null;
            showToast('已有该航线！');
            return;
        }

        const distKm = calcDistanceKm(
            selectedAirport.lat, selectedAirport.lng,
            airport.lat, airport.lng
        );

        if (distKm <= 200) {
            setAirportSelected(selectedAirport, false);
            selectedAirport = null;
            airport._hotzone.closePopup();
            showToast('航线太短，无法创建');
            return;
        }

        routePending = { from: selectedAirport, to: airport };
        airport._hotzone.openPopup();

        document.getElementById('route-from-name').textContent = selectedAirport.name;
        document.getElementById('route-from-iata').textContent = selectedAirport.iata;
        document.getElementById('route-to-name').textContent = airport.name;
        document.getElementById('route-to-iata').textContent = airport.iata;

        const demand = calcRouteDemandShared(selectedAirport.iata, airport.iata);
        if (demand) {
            demand.from = selectedAirport.iata;
            demand.to = airport.iata;
        }
        document.getElementById('route-demand').innerHTML = buildRouteDemandHTML(demand);

        const openFee = calcRouteOpenFee(distKm);
        const createBtn = document.getElementById('route-create-btn');
        if (createBtn) {
            if (gameState.money >= openFee) {
                createBtn.disabled = false;
                createBtn.textContent = '+ 建立';
            } else {
                createBtn.disabled = true;
                createBtn.textContent = '资金不足';
            }
        }

        openOverlay('route-overlay');
        return;
    }
}

function setAirportSelected(airport, selected) {
    const dot = airport._dot;
    const hotzone = airport._hotzone;
    if (!dot || !hotzone) return;

    if (selected) {
        dot.setRadius(6.5);
        dot.setStyle({ weight: 2 });
        hotzone.openPopup();
    } else {
        dot.setRadius(5);
        dot.setStyle({ weight: 1.5 });
        hotzone.closePopup();
    }
}

// ==================== 机场面板 ====================

function getAltitudeType(airport) {
    if (airport.isHighPlateau) return '高高原';
    if (airport.isPlateau) return '高原';
    return '非高原';
}

function openAirportPanel(iata) {
    const airport = AIRPORT_GCJ.find(function (a) {
        return a.iata === iata;
    });

    if (!airport) return;

    if (airport._hotzone) airport._hotzone.closePopup();

    const throughputStr = airport.throughput.toLocaleString('en-US');
    const indexStr = airport.airportIndex.toFixed(1);
    const altitudeStr = getAltitudeType(airport);

    const state = getAirportState(iata);
    const stateName = getAirportStateName(state);

    var actionHtml = '';
    var nextState = getNextAirportState(state);

    if (!nextState) {
        actionHtml = '<button class="ap-action-btn" disabled>已是基地</button>';
    } else {
        var fee = getAirportFee(airport, nextState);
        var ok = gameState.money >= fee;

        var btnCls = nextState === 'open' ? 'open-btn' :
                     nextState === 'hub' ? 'hub-btn' :
                     nextState === 'branch' ? 'branch-btn' :
                     nextState === 'subbase' ? 'subbase-btn' : 'hq-btn';

        var btnText = nextState === 'open'
            ? '开通通航'
            : ('升级' + getAirportStateName(nextState));

        actionHtml =
            '<button class="ap-action-btn ' + btnCls + '"' + (ok ? '' : ' disabled') +
            ' onclick="openAirportAction(\'' + iata + '\', \'' + nextState + '\')">' +
                (ok ? btnText + ' · ¥' + formatMoneyShort(fee).replace('¥', '')
                    : '资金不足 · 需 ¥' + formatMoneyShort(fee).replace('¥', '')) +
            '</button>';
    }

    const body = document.getElementById('airport-panel-body');

    body.innerHTML =
        '<div class="ap-panel-header">' +
            '<div class="ap-panel-name">' + airport.name + '</div>' +
            '<div class="ap-panel-code">' + airport.iata + '</div>' +
        '</div>' +
        '<div class="ap-panel-grid">' +
            '<div class="ap-panel-item">' +
                '<div class="ap-panel-label">年旅客吞吐量</div>' +
                '<div class="ap-panel-value">' + throughputStr + '<span class="unit">万人次</span></div>' +
            '</div>' +
            '<div class="ap-panel-item">' +
                '<div class="ap-panel-label">飞行区等级</div>' +
                '<div class="ap-panel-value">' + airport.grade + '</div>' +
            '</div>' +
            '<div class="ap-panel-item">' +
                '<div class="ap-panel-label">距市区</div>' +
                '<div class="ap-panel-value">' + airport.distance + '<span class="unit">km</span></div>' +
            '</div>' +
            '<div class="ap-panel-item">' +
                '<div class="ap-panel-label">海拔类型</div>' +
                '<div class="ap-panel-value">' + altitudeStr + '</div>' +
            '</div>' +
        '</div>' +
        '<div class="ap-panel-index">' +
            '<div class="ap-panel-index-label">机场指数</div>' +
            '<div class="ap-panel-index-value">' + indexStr + '</div>' +
        '</div>' +
        '<div class="ap-panel-status ' + state + '">' +
            '<span class="ap-panel-status-label">通航状态</span>' +
            '<span class="ap-panel-status-value">' + stateName + '</span>' +
        '</div>' +
        actionHtml;

    openOverlay('airport-panel-overlay');
}

function closeAirportPanel() {
    closeOverlay('airport-panel-overlay');
}

// ==================== 机场动作确认框 ====================

function openAirportAction(iata, targetState) {
    var airport = AIRPORT_GCJ.find(function (a) { return a.iata === iata; });
    if (!airport) return;

    var fee = getAirportFee(airport, targetState);
    if (gameState.money < fee) {
        showToast('资金不足');
        return;
    }

    apActionIata = iata;
    apActionTarget = targetState;

    var title = targetState === 'open' ? '确认开通' : '确认升级';
    var targetName = getAirportStateName(targetState);

    var descText = targetState === 'open'
        ? '开通 <b>' + airport.name + ' ' + airport.iata + '</b> 的通航？<br>开通后即可在此机场建立航线。'
        : '将 <b>' + airport.name + ' ' + airport.iata + '</b> 升级为' + targetName + '？';

    var btnCls = '';
    if (targetState === 'hub') btnCls = ' green';
    else if (targetState === 'branch') btnCls = ' yellow';
    else if (targetState === 'subbase') btnCls = ' orange';
    else if (targetState === 'hq') btnCls = ' red';

    document.getElementById('ap-action-title').textContent = title;
    document.getElementById('ap-action-body').innerHTML =
        '<div class="confirm-text">' + descText + '</div>' +
        '<div class="ap-confirm-info">' +
            '<div class="ap-confirm-row"><span>机场</span><b>' + airport.name + '</b></div>' +
            '<div class="ap-confirm-row"><span>吞吐量</span><b>' + airport.throughput.toLocaleString('en-US') + ' 万</b></div>' +
            '<div class="ap-confirm-row total"><span>' + (targetState === 'open' ? '通航费' : '升级费') + '</span><b>¥ ' + formatMoneyShort(fee).replace('¥', '') + '</b></div>' +
        '</div>' +
        '<div class="confirm-actions">' +
            '<button class="confirm-btn cancel" onclick="closeAirportAction()">取消</button>' +
            '<button class="confirm-btn ok' + btnCls + '" onclick="confirmAirportAction()">确认</button>' +
        '</div>';

    openOverlay('airport-action-overlay');
}

function closeAirportAction() {
    closeOverlay('airport-action-overlay');
    apActionIata = null;
    apActionTarget = null;
}

function confirmAirportAction() {
    if (!apActionIata || !apActionTarget) return;

    var airport = AIRPORT_GCJ.find(function (a) { return a.iata === apActionIata; });
    if (!airport) {
        closeAirportAction();
        return;
    }

    var fee = getAirportFee(airport, apActionTarget);
    if (gameState.money < fee) {
        showToast('资金不足');
        closeAirportAction();
        return;
    }

    setAirportState(apActionIata, apActionTarget);
    var targetName = getAirportStateName(apActionTarget);
    var apName = airport.name;

    changeMoney(-fee, `开通/升级机场：${apName} ${targetName}`);

    refreshAirportDot(apActionIata);

    closeAirportAction();
    closeAirportPanel();

    showToast(apName + ' 已' + (apActionTarget === 'open' ? '开通' : '升级为 ' + targetName));

    renderAirlinePanel();
}

// ==================== 飞机详情 ====================

function openPlaneDetail(planeIdx) {
    const plane = gameState.fleet[planeIdx];
    if (!plane) return;

    planeDetailIdx = planeIdx;

    const ac = getAircraftData(plane.type);

    document.getElementById('pd-name').textContent = plane.name;
    const cat = ac.wakeCategory || 'M';
    document.getElementById('pd-sub').innerHTML =
        ac.displayName + ' · ' + getPlaneTotalSeats(plane) + ' 座' +
        ' <span class="pd-cat ' + cat + '">' + cat + '</span>';

    const homeAirport = AIRPORT_GCJ.find(function (a) {
        return a.iata === plane.home;
    });
    document.getElementById('pd-home').textContent =
        homeAirport ? homeAirport.name + ' ' + homeAirport.iata : '—';

    const mtowTon = Math.round(ac.mtow / 1000);
    const priceYi = (ac.newPrice / 100000000).toFixed(1);

    document.getElementById('pd-seats').textContent = getPlaneTotalSeats(plane) + ' 座';
    document.getElementById('pd-speed').textContent = ac.cruiseSpeed + ' km/h';
    document.getElementById('pd-range').textContent = ac.range + ' km';
    document.getElementById('pd-mtow').textContent = mtowTon + ' 吨';
    document.getElementById('pd-payload').textContent = ac.maxPayload + ' 吨';
    document.getElementById('pd-fuel').textContent = ac.fuelCapacity + ' 升';
    document.getElementById('pd-burn').textContent = ac.cruiseFuelBurn + ' 升/千米';
    document.getElementById('pd-price').textContent = '¥ ' + priceYi + ' 亿';

    if (plane.schedule) {
        const sched = plane.schedule;
        const fromAp = AIRPORT_GCJ.find(function (a) { return a.iata === sched.from; });
        const toAp = AIRPORT_GCJ.find(function (a) { return a.iata === sched.to; });

        const routeName = (fromAp && toAp)
            ? fromAp.name + ' → ' + toAp.name
            : sched.from + ' → ' + sched.to;

        document.getElementById('pd-route').textContent = routeName;
        document.getElementById('pd-flights').textContent = sched.flightsPerDay + ' 趟';
        document.getElementById('pd-firstdep').textContent = minToHHMM(sched.firstDepartMin || 0);
        document.getElementById('pd-schedule-section').style.display = '';
    } else {
        document.getElementById('pd-schedule-section').style.display = 'none';
    }

    refreshPlaneDetailLive();

    if (planeDetailTimer) clearInterval(planeDetailTimer);
    planeDetailTimer = setInterval(refreshPlaneDetailLive, 500);

    openOverlay('plane-detail-overlay');
}

function closePlaneDetail() {
    if (planeDetailTimer) {
        clearInterval(planeDetailTimer);
        planeDetailTimer = null;
    }
    planeDetailIdx = -1;
    closeOverlay('plane-detail-overlay');
}

function refreshPlaneDetailLive() {
    if (planeDetailIdx < 0) return;
    const plane = gameState.fleet[planeDetailIdx];
    if (!plane) return;

    const hasSchedule = !!plane.schedule;
    const maint = plane.maintenanceUntilMs > 0;
    const pending = !!plane.pendingCheck;

    var statusText = '闲置';
    if (maint) statusText = '检修中';
    else if (pending) statusText = '待检修';
    else if (hasSchedule) statusText = '运营中';
    document.getElementById('pd-status').textContent = statusText;

    document.getElementById('pd-age').textContent = formatPlaneAge(plane);

    var fh = plane.totalFh || 0;
    document.getElementById('pd-fh').textContent =
        Math.round(fh).toLocaleString('en-US') + ' h';

    if (maint || pending) {
        document.getElementById('pd-nextcheck').textContent = '—';
    } else {
        var info = getNextCheckInfo(plane);
        if (info) {
            var remainStr = Math.max(0, Math.round(info.remain)).toLocaleString('en-US');
            document.getElementById('pd-nextcheck').textContent = info.level + ' 检 · ' + remainStr + ' h';
        } else {
            document.getElementById('pd-nextcheck').textContent = '—';
        }
    }

    document.getElementById('pd-loc').textContent = getPlaneLocationText(plane);

    if (hasSchedule && !maint && !pending) {
        document.getElementById('pd-live-section').style.display = '';
        const load = getPlaneCurrentLoad(plane);
        if (load) {
            document.getElementById('pd-pax').textContent = load.pax + ' 人';
            document.getElementById('pd-lf').textContent = (load.lf * 100).toFixed(1) + '%';
        } else {
            document.getElementById('pd-pax').textContent = '—';
            document.getElementById('pd-lf').textContent = '—';
        }
    } else {
        document.getElementById('pd-live-section').style.display = 'none';
    }

    if (maint || pending) {
        document.getElementById('pd-maint-section').style.display = '';
        renderMaintenanceSection(plane, planeDetailIdx);
    } else {
        document.getElementById('pd-maint-section').style.display = 'none';
    }
}

function renderMaintenanceSection(plane, planeIdx) {
    var box = document.getElementById('pd-maint-content');

    if (plane.maintenanceUntilMs > 0) {
        var remainMs = plane.maintenanceUntilMs - gameTimeMs;
        if (remainMs < 0) remainMs = 0;
        var remainDays = Math.ceil(remainMs / MS_PER_DAY);

        box.innerHTML =
            '<div class="pd-maint-box maint">' +
                '<div class="pd-maint-title">检修中</div>' +
                '<div class="pd-maint-desc">' +
                    '剩余 <b>' + remainDays + ' 天</b>，检修完成后自动恢复运营。' +
                '</div>' +
            '</div>';
        return;
    }

    var level = plane.pendingCheck;
    var cost = getCheckCost(plane, level);
    var downtime = CHECK_DOWNTIME_DAYS[level];
    var canAfford = gameState.money >= cost;

    var desc = '该机飞行小时已达 ' + level + ' 检阈值，需停场 ' + downtime + ' 天。';

    var retireHtml = '';
    if (level === 'D') {
        var retireValue = Math.round(getPlaneResaleValue(plane) * 0.6);
        retireHtml =
            '<button class="pd-maint-btn retire" onclick="retirePlane(' + planeIdx + ')">' +
                '退役 · +¥' + formatMoneyShort(retireValue).replace('¥', '') +
            '</button>';
    }

    box.innerHTML =
        '<div class="pd-maint-box">' +
            '<div class="pd-maint-title">需要 ' + level + ' 检</div>' +
            '<div class="pd-maint-desc">' +
                desc + '<br>费用：<b>¥ ' + formatMoneyShort(cost).replace('¥', '') + '</b>' +
            '</div>' +
            '<div class="pd-maint-actions">' +
                '<button class="pd-maint-btn send"' + (canAfford ? '' : ' disabled') +
                    ' onclick="startMaintenance(' + planeIdx + ')">' +
                    (canAfford ? '送检 · ¥' + formatMoneyShort(cost).replace('¥', '') : '资金不足') +
                '</button>' +
                retireHtml +
            '</div>' +
        '</div>';
}

function getPlaneCurrentLoad(plane) {
    if (!plane || !plane.schedule) return null;
    if (isUnderMaintenance(plane)) return null;

    const sched = plane.schedule;
    const dur = calcFlightDuration(sched.from, sched.to, plane.type);
    if (!dur) return null;

    const firstMin = sched.firstDepartMin || 0;

    const d = new Date(gameTimeMs);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const elapsedMin = (gameTimeMs - dayStart) / 60000;
    const totalEndMin = firstMin + sched.flightsPerDay * dur.roundMin;

    if (elapsedMin < firstMin || elapsedMin >= totalEndMin) return null;

    const localElapsed = elapsedMin - firstMin;
    const roundIdx = Math.floor(localElapsed / dur.roundMin);
    const roundElapsed = localElapsed - roundIdx * dur.roundMin;

    let totalPax = 0;
    let totalSeats = getPlaneTotalSeats(plane);

    if (roundElapsed < dur.flightMin) {
        if (plane._paxOutbound !== undefined) totalPax = plane._paxOutbound;
        else return null;
    } else if (roundElapsed < dur.flightMin + dur.turnTo) {
        return null;
    } else if (roundElapsed < 2 * dur.flightMin + dur.turnTo) {
        if (plane._paxReturn !== undefined) totalPax = plane._paxReturn;
        else return null;
    } else {
        return null;
    }

    return {
        pax: totalPax,
        lf: totalSeats > 0 ? (totalPax / totalSeats) : 0
    };
}

// ==================== 航线需求展示 ====================

function buildRouteDemandHTML(demand) {
    if (!demand) return '';

    const fare = calcBaseFare(demand.from, demand.to);
    const openFee = calcRouteOpenFee(demand.distance);

    return (
        '<div class="route-fare">' +
            '<div class="route-fare-label">基准票价</div>' +
            '<div class="route-fare-value">¥ ' + fare.toLocaleString('en-US') + '</div>' +
        '</div>' +
        '<div class="route-open-fee">' +
            '<div class="route-open-fee-label">航线开通费</div>' +
            '<div class="route-open-fee-value">¥ ' + (openFee / 10000).toFixed(2) + ' 万</div>' +
        '</div>' +
        '<div class="route-demand-grid">' +
            '<div class="rd-item">' +
                '<div class="rd-label">航距</div>' +
                '<div class="rd-value">' + Math.round(demand.distance) + '<span class="unit">km</span></div>' +
            '</div>' +
            '<div class="rd-item">' +
                '<div class="rd-label">日均客流</div>' +
                '<div class="rd-value rd-highlight">' + Math.round(demand.total) + '<span class="unit">人次</span></div>' +
            '</div>' +
            '<div class="rd-item">' +
                '<div class="rd-label">旅游客流</div>' +
                '<div class="rd-value">' + Math.round(demand.tourism) + '<span class="unit">人次</span></div>' +
            '</div>' +
            '<div class="rd-item">' +
                '<div class="rd-label">商务客流</div>' +
                '<div class="rd-value">' + Math.round(demand.business) + '<span class="unit">人次</span></div>' +
            '</div>' +
        '</div>'
    );
}

// ==================== 建航线 ====================

function drawRoute(from, to, silent) {
    const pts = makeArc(from, to, 60);

    const line = L.polyline(pts, {
        color: '#2563eb',
        weight: 2,
        opacity: 0.7,
        interactive: false
    }).addTo(gameMap);

    const hitLine = L.polyline(pts, {
        color: '#000000',
        weight: 18,
        opacity: 0,
        interactive: true,
        pane: 'routeHitPane'
    }).addTo(gameMap);

    const routeObj = {
        from: from.iata,
        to: to.iata,
        fromName: from.name,
        toName: to.name,
        line: line,
        hitLine: hitLine
    };

    routes.push(routeObj);

    hitLine.on('click', function (e) {
        L.DomEvent.stopPropagation(e);
        openRouteDetail(routeObj);
    });

    if (!silent) {
        showToast(from.iata + ' → ' + to.iata + ' 航线已建立');
    }
}

function clearAllRoutes() {
    routes.forEach(function (r) {
        if (r.line && gameMap) gameMap.removeLayer(r.line);
        if (r.hitLine && gameMap) gameMap.removeLayer(r.hitLine);
    });
    routes = [];
}

function closeRouteModal() {
    closeOverlay('route-overlay');

    if (selectedAirport) {
        setAirportSelected(selectedAirport, false);
    }
    selectedAirport = null;

    if (routePending && routePending.to) {
        routePending.to._hotzone.closePopup();
    }
    routePending = null;
}

function confirmRoute(btn) {
    if (btn.disabled) return;
    if (btn.classList.contains('pressed')) return;
    btn.classList.add('pressed');

    setTimeout(function () {
        btn.classList.remove('pressed');

        if (!routePending) return;

        const from = routePending.from;
        const to = routePending.to;

        if (!isAirportOpen(from.iata) || !isAirportOpen(to.iata)) {
            showToast('两端机场都需先通航');
            return;
        }

        const distKm = calcDistanceKm(from.lat, from.lng, to.lat, to.lng);
        const openFee = calcRouteOpenFee(distKm);

        if (gameState.money < openFee) {
            showToast('资金不足');
            return;
        }

        changeMoney(-openFee, `开通航线：${from.iata}-${to.iata}`);

        drawRoute(from, to);
        addReputation(openFee / 100000000);

        setAirportSelected(from, false);
        to._hotzone.closePopup();

        selectedAirport = null;
        routePending = null;

        closeOverlay('route-overlay');

        renderRouteTab();
        renderAirlinePanel();
    }, 200);
}

// ==================== 航线详情 ====================

function openRouteDetail(route) {
    document.getElementById('rd-from-name').textContent = route.fromName;
    document.getElementById('rd-from-iata').textContent = route.from;
    document.getElementById('rd-to-name').textContent = route.toName;
    document.getElementById('rd-to-iata').textContent = route.to;

    const demand = calcRouteDemandShared(route.from, route.to);
    if (demand) {
        demand.from = route.from;
        demand.to = route.to;
    }
    document.getElementById('route-detail-demand').innerHTML =
        buildRouteDemandHTML(demand);

    openOverlay('route-detail-overlay');
}

function closeRouteDetail() {
    closeOverlay('route-detail-overlay');
}

// ==================== 机队列表 ====================

function renderFleet() {
    const list = document.getElementById('fleet-list');

    if (gameState.fleet.length === 0) {
        list.innerHTML = '<div class="fleet-empty">暂无飞机，点右上角采购</div>';
        renderAirlinePanel();
        return;
    }

    let html = '';
    gameState.fleet.forEach(function (plane, idx) {
        const data = getAircraftData(plane.type);

        const homeAirport = AIRPORT_GCJ.find(function (a) {
            return a.iata === plane.home;
        });
        const homeName = homeAirport ? homeAirport.name : '—';

        var statusText, statusCls;
        if (plane.maintenanceUntilMs > 0) {
            statusText = '检修中';
            statusCls = 'fc-status maint';
        } else if (plane.pendingCheck) {
            statusText = '待检修';
            statusCls = 'fc-status pending';
        } else if (plane.schedule) {
            statusText = '运营中';
            statusCls = 'fc-status active';
        } else {
            statusText = '闲置';
            statusCls = 'fc-status';
        }

        html +=
            '<div class="fleet-card">' +
                '<div class="fc-top">' +
                    '<span class="fc-name" onclick="openPlaneDetail(' + idx + ')">' + plane.name + '</span>' +
                    '<div class="fc-right">' +
                        '<span class="' + statusCls + '">' + statusText + '</span>' +
                        '<span class="fc-home">' + homeName + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="fc-info">' +
                    data.displayName + ' · ' + getPlaneTotalSeats(plane) + ' 座' +
                '</div>' +
                '<div class="fc-actions">' +
                    '<button class="fleet-btn schedule" data-plane-idx="' + idx + '" onclick="fleetSchedule(this)">时刻表</button>' +
                    '<button class="fleet-btn sell" data-plane-idx="' + idx + '" onclick="fleetSell(this)">出售</button>' +
                '</div>' +
            '</div>';
    });
    list.innerHTML = html;
    renderAirlinePanel();
}

function fleetSchedule(btn) {
    if (btn.classList.contains('pressed')) return;
    btn.classList.add('pressed');
    setTimeout(function () {
        btn.classList.remove('pressed');
        const idx = parseInt(btn.getAttribute('data-plane-idx'), 10);
        openScheduleModal(idx);
    }, 200);
}

function fleetSell(btn) {
    if (btn.classList.contains('pressed')) return;
    btn.classList.add('pressed');

    setTimeout(function () {
        btn.classList.remove('pressed');
        const idx = parseInt(btn.getAttribute('data-plane-idx'), 10);
        openSellConfirm(idx);
    }, 200);
}

// ==================== 出售飞机 ====================

function openSellConfirm(planeIdx) {
    const plane = gameState.fleet[planeIdx];
    if (!plane) return;

    if (isUnderMaintenance(plane)) {
        showToast('检修中的飞机不可出售');
        return;
    }

    pendingSellIdx = planeIdx;

    const ac = getAircraftData(plane.type);
    const value = getPlaneResaleValue(plane);

    document.getElementById('sell-info-name').textContent = plane.name;
    document.getElementById('sell-info-type').textContent =
        ac.displayName + ' · ' + getPlaneTotalSeats(plane) + ' 座';
    document.getElementById('sell-info-age').textContent = formatPlaneAge(plane);
    document.getElementById('sell-info-price').textContent =
        '¥ ' + (value / 100000000).toFixed(2) + ' 亿';

    const textEl = document.getElementById('sell-confirm-text');
    if (plane.schedule) {
        textEl.innerHTML =
            '确定要出售 <b>' + escapeHtml(plane.name) + '</b> 吗？<br>' +
            '<span style="color:#dc2626;">该机正在运营，出售后将取消时刻表。</span>';
    } else {
        textEl.innerHTML = '确定要出售 <b>' + escapeHtml(plane.name) + '</b> 吗？';
    }

    openOverlay('sell-plane-overlay');
}

function closeSellConfirm() {
    closeOverlay('sell-plane-overlay');
    pendingSellIdx = -1;
}

function confirmSellPlane() {
    if (pendingSellIdx < 0) return;

    const plane = gameState.fleet[pendingSellIdx];
    if (!plane) {
        closeSellConfirm();
        return;
    }

    const value = getPlaneResaleValue(plane);
    const planeName = plane.name;

    if (plane._marker) {
        if (gameMap) gameMap.removeLayer(plane._marker);
        const mi = planeMarkers.indexOf(plane._marker);
        if (mi >= 0) planeMarkers.splice(mi, 1);
    }

    gameState.fleet.splice(pendingSellIdx, 1);

    changeMoney(value, `出售飞机 (${planeName})`);

    pendingSellIdx = -1;

    closeOverlay('sell-plane-overlay');

    renderFleet();
    renderAirlinePanel();

    showToast('已出售 ' + planeName + ' · +¥' + formatMoneyShort(value).replace('¥', ''));
}

// ==================== 购买飞机 · 双模式 ====================

function openBuyModal(btn) {
    if (btn.classList.contains('pressed')) return;
    btn.classList.add('pressed');

    setTimeout(function () {
        btn.classList.remove('pressed');

        buyMode = 'card';
        buySource = 'new';
        buySwitchLock = false;

        document.querySelectorAll('.buy-mode-seg[data-source]').forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-source') === 'new');
        });
        document.querySelectorAll('.buy-mode-seg[data-mode]').forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-mode') === 'card');
        });

        renderBuyList();

        document.getElementById('buy-modal-body').style.opacity = '1';

        var dim = document.getElementById('buy-dim');
        var shell = document.getElementById('buy-modal-shell');

        dim.style.zIndex = overlayZCounter++;
        shell.style.zIndex = overlayZCounter++;

        dim.classList.add('active');
        dim.classList.remove('no-dim'); // 强制移出透明状态
        shell.classList.add('active');

        layoutBuyModal('card', false);
    }, 200);
}

// 修复报错：点击购买飞机背景遮罩关闭弹窗
function onBuyDimClick(event) {
    if (event.target.id === 'buy-dim') {
        closeBuyModal();
    }
}

function closeBuyModal() {
    document.getElementById('buy-dim').classList.remove('active');
    document.getElementById('buy-modal-shell').classList.remove('active');
    refreshOverlayDim();
}

function layoutBuyModal(mode, animate) {
    var shell = document.getElementById('buy-modal-shell');
    var mainArea = document.querySelector('.main-area');
    if (!mainArea || !shell) return;

    var rect = mainArea.getBoundingClientRect();
    var topOffset = Math.max(rect.height * 0.22, 100);

    var availTop = rect.top + topOffset;
    var availBottom = rect.bottom;
    var availH = availBottom - availTop;

    var PAD = 20;
    var viewportW = window.innerWidth;

    var w, h, left, top;

    if (mode === 'card') {
        w = Math.min(560, rect.width - PAD * 2);
        h = Math.min(460, availH - PAD * 2);
        left = rect.left + (rect.width - w) / 2;
        top = availTop + (availH - h) / 2;
    } else {
        w = Math.min(980, viewportW - PAD * 2);
        h = availH - PAD * 2;
        left = (viewportW - w) / 2;
        top = availTop + PAD;
    }

    if (animate === false) {
        var oldTransition = shell.style.transition;
        shell.style.transition = 'none';
        shell.style.left = left + 'px';
        shell.style.top = top + 'px';
        shell.style.width = w + 'px';
        shell.style.height = h + 'px';
        void shell.offsetWidth;
        shell.style.transition = oldTransition || '';
    } else {
        shell.style.left = left + 'px';
        shell.style.top = top + 'px';
        shell.style.width = w + 'px';
        shell.style.height = h + 'px';
    }
}

function setBuySource(source, event) {
    if (event) event.stopPropagation();
    if (buySource === source) return;
    buySource = source;
    
    document.querySelectorAll('.buy-mode-seg[data-source]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-source') === source);
    });
    
    renderBuyList();
}

function setBuyMode(mode, event) {
    if (event) event.stopPropagation();
    if (buySwitchLock) return;
    if (mode === buyMode) return;

    buySwitchLock = true;
    buyMode = mode;

    document.querySelectorAll('.buy-mode-seg[data-mode]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });

    var body = document.getElementById('buy-modal-body');
    body.style.opacity = '0';

    setTimeout(function () {
        renderBuyList();
        layoutBuyModal(mode, true);

        setTimeout(function () {
            body.style.opacity = '1';
            buySwitchLock = false;
        }, 100);
    }, 160);
}

function renderBuyList() {
    document.getElementById('buy-list-card').style.display = (buyMode === 'card') ? 'flex' : 'none';
    document.getElementById('buy-list-table').style.display = (buyMode === 'table') ? 'flex' : 'none';

    if (buySource === 'new') {
        if (buyMode === 'card') renderCardList();
        else renderTableList();
    } else {
        if (buyMode === 'card') renderUsedCardList();
        else renderUsedTableList();
    }
}

// ==================== 全新飞机渲染 ====================

function renderCardList() {
    var list = document.getElementById('buy-list-card');
    if (!list) return;

    let html = '';

    Object.values(AIRCRAFT_DATA).forEach(function (ac) {
        const canAfford = gameState.money >= ac.newPrice;
        const priceYi = (ac.newPrice / 100000000).toFixed(1);
        const mtowTon = Math.round(ac.mtow / 1000);
        const maxSeats = ac.maxRows * ac.seatsPerRow.Y;

        html +=
            '<div class="plane-card">' +
                '<div class="pc-name">' + ac.name + '</div>' +
                '<div class="pc-price">¥ ' + priceYi + ' 亿</div>' +
                '<div class="pc-stats">' +
                    '<span>🛫 巡航速度：' + ac.cruiseSpeed + ' km/h</span>' +
                    '<span>📏 航程：' + ac.range + ' km</span>' +
                    '<span>⚖️ 最大起飞重量：' + mtowTon + ' 吨</span>' +
                    '<span>📦 最大载重：' + ac.maxPayload + ' 吨</span>' +
                    '<span>⛽ 燃油容量：' + ac.fuelCapacity + ' 升</span>' +
                    '<span>🔥 巡航油耗：' + ac.cruiseFuelBurn + ' 升/千米</span>' +
                    '<span>💺 最大座位数：' + maxSeats + ' 座</span>' +
                '</div>' +
                '<button class="pc-buy" data-type="' + ac.shortName + '"' +
                    (canAfford ? '' : ' disabled') +
                    ' onclick="buyPlane(this)">' +
                    (canAfford ? '购买' : '资金不足') +
                '</button>' +
            '</div>';
    });

    list.innerHTML = html;
}

function getSortedAircraft() {
    var arr = Object.values(AIRCRAFT_DATA).slice();
    arr.sort(function (a, b) {
        var va, vb;
        if (buySortKey === 'displayName') {
            va = a.displayName; vb = b.displayName;
            return buySortAsc ? va.localeCompare(vb, 'zh') : vb.localeCompare(va, 'zh');
        }
        va = a[buySortKey];
        vb = b[buySortKey];
        return buySortAsc ? (va - vb) : (vb - va);
    });
    return arr;
}

var BUY_TABLE_COLS = [
    { key: 'displayName',   label: '机型' },
    { key: 'newPrice',      label: '价格' },
    { key: 'maxRows',       label: '排数上限' },
    { key: 'cruiseSpeed',   label: '速度' },
    { key: 'range',         label: '航程' },
    { key: 'mtow',          label: 'MTOW' },
    { key: 'maxPayload',    label: '载重' },
    { key: 'fuelCapacity',  label: '油量' },
    { key: 'cruiseFuelBurn',label: '油耗' }
];

function renderTableList() {
    var list = document.getElementById('buy-list-table');
    if (!list) return;

    var sorted = getSortedAircraft();
    var thead = '<tr>';
    BUY_TABLE_COLS.forEach(function (col) {
        var sortedCls = (buySortKey === col.key) ? ' sorted' : '';
        var arrow = (buySortKey === col.key)
            ? '<span class="sort-icon">' + (buySortAsc ? '▲' : '▼') + '</span>'
            : '<span class="sort-icon">⇅</span>';

        thead += '<th class="' + sortedCls.trim() + '" onclick="sortBuyTable(\'' + col.key + '\')">' + col.label + arrow + '</th>';
    });
    thead += '<th class="no-sort bt-col-action">操作</th></tr>';

    var tbody = '';
    sorted.forEach(function (ac) {
        var canAfford = gameState.money >= ac.newPrice;
        tbody += '<tr>';
        tbody += '<td class="bt-name">' + ac.displayName + '</td>';
        tbody += '<td class="bt-price">' + (ac.newPrice / 100000000).toFixed(1) + ' 亿</td>';
        tbody += '<td>' + ac.maxRows + ' 排</td>';
        tbody += '<td>' + ac.cruiseSpeed + ' km/h</td>';
        tbody += '<td>' + ac.range.toLocaleString('en-US') + ' km</td>';
        tbody += '<td>' + Math.round(ac.mtow / 1000) + ' t</td>';
        tbody += '<td>' + ac.maxPayload + ' t</td>';
        tbody += '<td>' + ac.fuelCapacity.toLocaleString('en-US') + ' L</td>';
        tbody += '<td>' + ac.cruiseFuelBurn + ' L/km</td>';
        tbody += '<td class="bt-col-action"><button class="bt-buy" data-type="' + ac.shortName + '"' +
                    (canAfford ? '' : ' disabled') + ' onclick="buyPlane(this)">' +
                    (canAfford ? '购买' : '不足') + '</button></td>';
        tbody += '</tr>';
    });

    list.innerHTML = '<div class="buy-table-wrap"><table class="buy-table"><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table></div>';
}

function sortBuyTable(key) {
    if (buySortKey === key) buySortAsc = !buySortAsc;
    else { buySortKey = key; buySortAsc = true; }
    renderTableList();
}

// ==================== 二手飞机渲染 ====================

function renderUsedCardList() {
    var list = document.getElementById('buy-list-card');
    if (!list) return;

    if (secondhandMarket.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:40px; color:#94a3b8;">暂无二手飞机在售</div>';
        return;
    }

    let html = '';
    secondhandMarket.forEach(function (p, idx) {
        let layoutHtml = '';
        ['P', 'F', 'C', 'W', 'Y'].forEach(k => {
            if (p.cabin[k] > 0) {
                layoutHtml += `<span class="layout-tag ${k}">${k} ${p.cabin[k]}排</span>`;
            }
        });

        let fhClass = p.nextDCheck < 1000 ? 'warn' : (p.nextDCheck < 3000 ? '' : 'good');
        let fhText = p.nextDCheck < 1000 ? `距 D 检 ${p.nextDCheck}h (危险)` : `距 D 检 ${p.nextDCheck}h`;

        html += `
            <div class="plane-card is-used">
                <div class="pc-header">
                    <div>
                        <div class="pc-name">${p.displayName}</div>
                        <div style="font-size:11px;color:#64748b;margin-top:4px;">机龄 ${p.age.toFixed(1)} 年 · 飞行 ${p.fh.toLocaleString()} h</div>
                    </div>
                    <div class="pc-price-box">
                        <div class="pc-price">¥ ${(p.price/100000000).toFixed(2)} 亿</div>
                        <div class="pc-orig-price">原价 ¥${(p.origPrice/100000000).toFixed(1)}亿</div>
                    </div>
                </div>
                <div class="pc-stats">
                    <div class="stat-item"><span>定检状态</span><span class="stat-val ${fhClass}">${fhText}</span></div>
                    <div class="stat-item"><span>总座位</span><span class="stat-val">${getPlaneTotalSeats(p)} 座</span></div>
                </div>
                <div class="pc-layout">${layoutHtml}</div>
                <button class="btn-buy" onclick="buyUsedPlane(${idx})">购买</button>
            </div>
        `;
    });

    list.innerHTML = html;
}

function renderUsedTableList() {
    var list = document.getElementById('buy-list-table');
    if (list) list.innerHTML = '<div style="text-align:center; padding:40px; color:#94a3b8;">二手飞机暂不支持表格视图</div>';
}

// ==================== 购买流程 ====================

function buyPlane(btn) {
    if (btn.disabled) return;

    const type = btn.getAttribute('data-type');
    const ac = getAircraftData(type);

    if (gameState.money < ac.newPrice) {
        showToast('资金不足');
        return;
    }

    if (btn.classList.contains('pressed')) return;
    btn.classList.add('pressed');

    setTimeout(function () {
        btn.classList.remove('pressed');

        selectedAircraftType = type;
        selectedUsedPlaneIdx = -1; // 标记为全新

        const nextSeq = countFleetByType(type) + 1;
        const defaultName = getDefaultPlaneName(type) + '-' + String(nextSeq).padStart(4, '0');

        document.getElementById('naming-aircraft-type').textContent =
            ac.displayName + ' · 最多 ' + (ac.maxRows * ac.seatsPerRow.Y) + ' 座';

        const input = document.getElementById('naming-input');
        input.value = defaultName;

        document.getElementById('cabin-config-box').style.display = 'block';
        const labels = document.querySelectorAll('.naming-form label');
        labels.forEach(l => {
            if(l.textContent === '客舱布局') l.style.display = 'block';
        });

        initNamingCabinUI(ac);

        openNamingModal();

        setTimeout(function () {
            input.focus();
            input.select();
        }, 100);
    }, 200);
}

function buyUsedPlane(idx) {
    const p = secondhandMarket[idx];
    if (!p) return;
    
    if (gameState.money < p.price) {
        showToast('资金不足');
        return;
    }

    selectedAircraftType = p.type;
    selectedUsedPlaneIdx = idx;

    document.getElementById('naming-aircraft-type').textContent = p.displayName + ' (二手)';
    const input = document.getElementById('naming-input');
    
    const nextSeq = countFleetByType(p.type) + 1;
    const baseName = p.displayName.replace(/^(空客|波音)\s*/, '');
    input.value = baseName + '-' + String(nextSeq).padStart(4, '0');

    document.getElementById('cabin-config-box').style.display = 'none';
    const labels = document.querySelectorAll('.naming-form label');
    labels.forEach(l => {
        if(l.textContent === '客舱布局') l.style.display = 'none';
    });

    openNamingModal();

    setTimeout(function () {
        input.focus();
        input.select();
    }, 100);
}

function initNamingCabinUI(ac) {
    currentCabinMaxRows = ac.maxRows;
    currentCabinConfig = { P: 0, F: 0, C: 0, W: 0, Y: ac.maxRows };

    ['P', 'F', 'C', 'W', 'Y'].forEach(function(k) {
        var metaEl = document.getElementById('cabin-meta-' + k.toLowerCase());
        if (metaEl) {
            metaEl.textContent = ac.seatsPerRow[k] + '座/排';
        }
    });

    ['P', 'F', 'C', 'W', 'Y'].forEach(function(k) {
        let plusId = 'cabin-btn-' + k.toLowerCase() + '-plus';
        let minusId = 'cabin-btn-' + k.toLowerCase() + '-minus';
        bindCabinBtn(plusId, k, 1);
        bindCabinBtn(minusId, k, -1);
    });

    updateNamingCabinUI();
}

function bindCabinBtn(id, type, delta) {
    const btn = document.getElementById(id);
    if (!btn) return;

    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    const startAction = function(e) {
        e.preventDefault();
        if (newBtn.disabled) return;
        changeCabinVal(type, delta);

        cabinHoldTimer = setTimeout(function() {
            cabinHoldInterval = setInterval(function() {
                changeCabinVal(type, delta);
            }, 80);
        }, 150);
    };

    const endAction = function() {
        clearTimeout(cabinHoldTimer);
        clearInterval(cabinHoldInterval);
        cabinHoldTimer = null;
        cabinHoldInterval = null;
    };

    newBtn.addEventListener('mousedown', startAction);
    newBtn.addEventListener('touchstart', startAction, { passive: false });
    newBtn.addEventListener('mouseup', endAction);
    newBtn.addEventListener('mouseleave', endAction);
    newBtn.addEventListener('touchend', endAction);
    newBtn.addEventListener('touchcancel', endAction);
}

function changeCabinVal(type, delta) {
    let newVal = currentCabinConfig[type] + delta;
    if (newVal < 0) newVal = 0;

    let usedRows = 0;
    for (let k in currentCabinConfig) {
        let val = (k === type) ? newVal : currentCabinConfig[k];
        usedRows += val * CABIN_RULES[k].rows;
    }

    if (delta > 0 && usedRows > currentCabinMaxRows) return;

    currentCabinConfig[type] = newVal;
    updateNamingCabinUI();
}

function updateNamingCabinUI() {
    const ac = getAircraftData(selectedAircraftType);

    ['P', 'F', 'C', 'W', 'Y'].forEach(function(k) {
        document.getElementById('cabin-val-' + k.toLowerCase()).textContent = currentCabinConfig[k];
    });

    let usedRows = 0;
    let totalSeats = 0;
    let revIndex = 0;

    for (let k in currentCabinConfig) {
        let cnt = currentCabinConfig[k];
        let r = CABIN_RULES[k];
        usedRows += cnt * r.rows;

        let seatsPerRow = ac.seatsPerRow[k];
        let seats = cnt * seatsPerRow;
        totalSeats += seats;
        revIndex += seats * r.fare;
    }

    document.getElementById('cabin-space-display').innerHTML = '已用 ' + usedRows.toFixed(1) + ' / ' + currentCabinMaxRows + ' 排';
    document.getElementById('cabin-total-seats').textContent = totalSeats + ' 座';
    document.getElementById('cabin-rev-index').textContent = Math.round(revIndex);

    ['P', 'F', 'C', 'W', 'Y'].forEach(function(k) {
        let val = currentCabinConfig[k];
        let idPrefix = 'cabin-btn-' + k.toLowerCase();
        document.getElementById(idPrefix + '-minus').disabled = (val <= 0);

        let remain = currentCabinMaxRows - usedRows;
        document.getElementById(idPrefix + '-plus').disabled = (remain < CABIN_RULES[k].rows);
    });

    let vizHtml = '';
    ['P', 'F', 'C', 'W', 'Y'].forEach(function(k) {
        if (currentCabinConfig[k] > 0) {
            let r = CABIN_RULES[k];
            let widthPct = (currentCabinConfig[k] * r.rows / currentCabinMaxRows) * 100;
            let color = k === 'P' ? '#7e22ce' : k === 'F' ? '#dc2626' : k === 'C' ? '#ea580c' : k === 'W' ? '#0ea5e9' : '#2563eb';
            vizHtml += '<div class="cabin-viz-seg" style="width:' + widthPct + '%; background:' + color + ';">' + k + '</div>';
        }
    });
    document.getElementById('cabin-viz').innerHTML = vizHtml;
}

function openNamingModal() {
    selectedHomeIata = null;
    if (homeSelectCtrl) homeSelectCtrl.reset();
    updateNamingConfirmState();
    openOverlay('naming-overlay');
}

function closeNamingModal() {
    if (homeSelectCtrl) homeSelectCtrl.close();
    
    document.getElementById('cabin-config-box').style.display = 'block';
    const labels = document.querySelectorAll('.naming-form label');
    labels.forEach(l => {
        if(l.textContent === '客舱布局') l.style.display = 'block';
    });
    
    closeOverlay('naming-overlay');
}

function onNamingOverlayClick(event) {
    if (homeSelectCtrl && homeSelectCtrl.isOpen()) {
        homeSelectCtrl.close();
        return;
    }
    if (event.target.id === 'naming-overlay') {
        closeNamingModal();
    }
}

function updateNamingConfirmState() {
    const btn = document.getElementById('naming-confirm-btn');
    if (!btn) return;
    btn.disabled = !selectedHomeIata;
}

// ==================== 确认购买 ====================

function confirmBuy(btn) {
    if (btn.disabled) return;
    if (!selectedHomeIata) return;
    if (!selectedAircraftType) return;
    if (btn.classList.contains('pressed')) return;
    btn.classList.add('pressed');

    setTimeout(function () {
        btn.classList.remove('pressed');

        const ac = getAircraftData(selectedAircraftType);
        const input = document.getElementById('naming-input');
        let finalName = input.value.trim();

        let cost = ac.newPrice;
        let newPlane = null;

        if (selectedUsedPlaneIdx >= 0) {
            const usedPlane = secondhandMarket[selectedUsedPlaneIdx];
            cost = usedPlane.price;
            
            if (gameState.money < cost) {
                showToast('资金不足');
                closeNamingModal();
                return;
            }

            if (!finalName) finalName = usedPlane.displayName + '-二手';

            newPlane = {
                name: finalName,
                type: usedPlane.type,
                home: selectedHomeIata,
                cabin: usedPlane.cabin,
                schedule: null,
                purchaseTimeMs: gameTimeMs - (usedPlane.age * MS_PER_YEAR),
                totalFh: usedPlane.fh,
                nextACheckFh: usedPlane.nextACheckFh,
                nextCCheckFh: usedPlane.nextCCheckFh,
                nextDCheckFh: usedPlane.nextDCheckFh,
                maintenanceUntilMs: 0,
                pendingCheck: null,
                _marker: null,
                _state: null
            };
            
            secondhandMarket.splice(selectedUsedPlaneIdx, 1);

        } else {
            if (gameState.money < cost) {
                showToast('资金不足');
                closeNamingModal();
                return;
            }

            if (!finalName) {
                const nextSeq = countFleetByType(selectedAircraftType) + 1;
                finalName = getDefaultPlaneName(selectedAircraftType) + '-' + String(nextSeq).padStart(4, '0');
            }

            newPlane = {
                name: finalName,
                type: selectedAircraftType,
                home: selectedHomeIata,
                cabin: JSON.parse(JSON.stringify(currentCabinConfig)),
                schedule: null,
                purchaseTimeMs: gameTimeMs,
                totalFh: 0,
                nextACheckFh: CHECK_INTERVAL.A,
                nextCCheckFh: CHECK_INTERVAL.C,
                nextDCheckFh: CHECK_INTERVAL.D,
                maintenanceUntilMs: 0,
                pendingCheck: null,
                _marker: null,
                _state: null
            };
        }

        changeMoney(-cost, `购买飞机 (${finalName})`);
        gameState.fleet.push(newPlane);

        if (selectedUsedPlaneIdx < 0) {
            addReputation(ac.newPrice / 100000000 * 0.02);
        }

        renderFleet();
        addPlaneMarker(newPlane);

        closeNamingModal();
        closeBuyModal();

        showToast('已购买 ' + finalName);
        selectedUsedPlaneIdx = -1;
        
    }, 200);
}

// ==================== 机队地图标记 ====================

function addPlaneMarker(plane) {
    if (!gameMap) return;

    const home = AIRPORT_GCJ.find(function (a) {
        return a.iata === plane.home;
    });
    if (!home) return;

    const marker = L.marker([home.lat, home.lng], {
        icon: makePlaneIcon(),
        interactive: false
    }).addTo(gameMap);

    plane._marker = marker;
    planeMarkers.push(marker);

    updateSinglePlane(plane);
}

function clearAllPlaneMarkers() {
    planeMarkers.forEach(function (m) {
        if (gameMap) gameMap.removeLayer(m);
    });
    planeMarkers = [];

    gameState.fleet.forEach(function (p) {
        p._marker = null;
    });
}

function rebuildAllPlaneMarkers() {
    clearAllPlaneMarkers();
    gameState.fleet.forEach(function (p) {
        addPlaneMarker(p);
    });
}

function setPlaneRotation(marker, angle) {
    const el = marker.getElement();
    if (!el) return;
    const rot = el.querySelector('.plane-rot');
    if (rot) {
        rot.style.transform = 'rotate(' + angle + 'deg)';
    }
}

// ==================== 飞行位置 ====================

function updateSinglePlane(plane) {
    if (!plane._marker) return;

    const home = AIRPORT_GCJ.find(function (a) { return a.iata === plane.home; });

    if (plane.maintenanceUntilMs > 0) {
        if (gameTimeMs >= plane.maintenanceUntilMs) {
            plane.maintenanceUntilMs = 0;
            plane._state = null;

            if (home && plane._marker) {
                plane._marker.setLatLng([home.lat, home.lng]);
                setPlaneRotation(plane._marker, 0);
            }

            renderFleet();
            showToast(plane.name + ' 检修完成');
        } else {
            if (home) {
                plane._marker.setLatLng([home.lat, home.lng]);
                setPlaneRotation(plane._marker, 0);
            }
            return;
        }
    }

    if (plane.pendingCheck) {
        if (home) {
            plane._marker.setLatLng([home.lat, home.lng]);
            setPlaneRotation(plane._marker, 0);
        }
        return;
    }

    if (!plane.schedule) {
        if (home) {
            plane._marker.setLatLng([home.lat, home.lng]);
            setPlaneRotation(plane._marker, 0);
        }
        return;
    }

    const sched = plane.schedule;
    const dur = calcFlightDuration(sched.from, sched.to, plane.type);
    if (!dur) return;

    const a = AIRPORT_GCJ.find(function (x) { return x.iata === sched.from; });
    const b = AIRPORT_GCJ.find(function (x) { return x.iata === sched.to; });
    if (!a || !b) return;

    const firstMin = sched.firstDepartMin || 0;

    const d = new Date(gameTimeMs);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const elapsedMin = (gameTimeMs - dayStart) / 60000;

    const totalEndMin = firstMin + sched.flightsPerDay * dur.roundMin;

    if (elapsedMin < firstMin) {
        plane._marker.setLatLng([a.lat, a.lng]);
        setPlaneRotation(plane._marker, 0);
        handleSegAdvance(plane, -1);
        return;
    }

    if (elapsedMin >= totalEndMin) {
        plane._marker.setLatLng([a.lat, a.lng]);
        setPlaneRotation(plane._marker, 0);
        handleSegAdvance(plane, sched.flightsPerDay * 4 + 100);
        return;
    }

    const localElapsed = elapsedMin - firstMin;
    const roundIdx = Math.floor(localElapsed / dur.roundMin);
    const roundElapsed = localElapsed - roundIdx * dur.roundMin;

    let segLocal, lat, lng, angle;

    if (roundElapsed < dur.flightMin) {
        segLocal = 0;
        const fp = calcFlightProgress(sched.from, sched.to, plane.type, roundElapsed);
        const arc = getArcPoints(sched.from, sched.to);
        if (arc && fp) {
            const pt = interpolateArc(arc, fp.t);
            lat = pt.lat; lng = pt.lng;
            angle = interpolateArcAngle(arc, fp.t);
        } else {
            lat = a.lat; lng = a.lng; angle = 0;
        }
    } else if (roundElapsed < dur.flightMin + dur.turnTo) {
        segLocal = 1;
        lat = b.lat; lng = b.lng; angle = 0;
    } else if (roundElapsed < 2 * dur.flightMin + dur.turnTo) {
        segLocal = 2;
        const returnElapsed = roundElapsed - dur.flightMin - dur.turnTo;
        const fp = calcFlightProgress(sched.to, sched.from, plane.type, returnElapsed);
        const arc = getArcPoints(sched.to, sched.from);
        if (arc && fp) {
            const pt = interpolateArc(arc, fp.t);
            lat = pt.lat; lng = pt.lng;
            angle = interpolateArcAngle(arc, fp.t);
        } else {
            lat = b.lat; lng = b.lng; angle = 0;
        }
    } else {
        segLocal = 3;
        lat = a.lat; lng = a.lng; angle = 0;
    }

    plane._marker.setLatLng([lat, lng]);
    setPlaneRotation(plane._marker, angle);

    const absSeg = roundIdx * 4 + segLocal;
    handleSegAdvance(plane, absSeg);
}

function updatePlanesPosition() {
    if (!gameMap) return;
    gameState.fleet.forEach(function (plane) {
        updateSinglePlane(plane);
    });
}

// ==================== 段推进 & 结算 ====================

function handleSegAdvance(plane, absSeg) {
    if (!plane._state) {
        plane._state = { lastAbsSeg: absSeg };
        return;
    }

    const last = plane._state.lastAbsSeg;
    if (absSeg === last) return;
    if (absSeg < last) {
        plane._state.lastAbsSeg = absSeg;
        return;
    }

    for (let s = last + 1; s <= absSeg; s++) {
        emitSegmentStart(plane, s);
        if (plane.pendingCheck) break;
    }

    if (!plane._state) {
        plane._state = { lastAbsSeg: absSeg };
    } else {
        plane._state.lastAbsSeg = absSeg;
    }
}

function emitSegmentStart(plane, absSeg) {
    const sched = plane.schedule;
    if (!sched) return;
    if (plane.pendingCheck) return;

    const dur = calcFlightDuration(sched.from, sched.to, plane.type);
    if (!dur) return;

    if (absSeg < 0) return;
    if (absSeg >= sched.flightsPerDay * 4 + 100) return;
    if (absSeg >= sched.flightsPerDay * 4) return;

    const firstMin = sched.firstDepartMin || 0;
    const local = absSeg % 4;
    const roundIdx = Math.floor(absSeg / 4);

    const d = new Date(gameTimeMs);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

    let segOffsetMin;
    if (local === 0) segOffsetMin = 0;
    else if (local === 1) segOffsetMin = dur.flightMin;
    else if (local === 2) segOffsetMin = dur.flightMin + dur.turnTo;
    else segOffsetMin = 2 * dur.flightMin + dur.turnTo;

    const evtMs = dayStart + (firstMin + roundIdx * dur.roundMin + segOffsetMin) * 60000;
    const timeStr = fmtTimeFromMs(evtMs);

    const ac = getAircraftData(plane.type);
    const repDelta = (dur.flightMin / 60) * ac.reputationRate;
    const fhDelta = dur.flightMin / 60;

    const cabinDemands = calcCabinDemands(sched.from, sched.to);

    if (local === 0) {
        let totalPax = 0;
        for (let k in plane.cabin) {
            if (plane.cabin[k] > 0) {
                const cap = plane.cabin[k] * ac.seatsPerRow[k];
                totalPax += Math.min(cap, cabinDemands[k]);
            }
        }
        plane._paxOutbound = totalPax;

        const flightNo = getFlightNo(sched, roundIdx, false);
        pushFlightEvent({
            time: timeStr,
            flightNo: flightNo,
            plane: plane.name,
            from: sched.from,
            to: sched.to,
            type: 'dep'
        });

    } else if (local === 1) {
        const flightNo = getFlightNo(sched, roundIdx, false);
        const hasRoute = routeExists(sched.from, sched.to);
        const baseFare = calcBaseFare(sched.from, sched.to);

        let revenue = 0;
        let totalPax = 0;

        if (hasRoute) {
            for (let k in plane.cabin) {
                if (plane.cabin[k] > 0) {
                    const cap = plane.cabin[k] * ac.seatsPerRow[k];
                    const sold = Math.min(cap, cabinDemands[k]);
                    totalPax += sold;
                    revenue += sold * baseFare * CABIN_RULES[k].fare;
                }
            }
        }

        const cost = calcSegmentCost(plane.type, dur.distance);
        const net = revenue - cost.total;

        changeMoney(net, `航班收益 (${flightNo})`);

        pushFlightEvent({
            time: timeStr,
            flightNo: flightNo,
            plane: plane.name,
            from: sched.from,
            to: sched.to,
            type: 'arr',
            amount: revenue,
            cost: cost.total,
            pax: totalPax
        });
        addTodayFlight(revenue);
        addReputation(repDelta);
        accumulateFh(plane, fhDelta);

    } else if (local === 2) {
        let totalPax = 0;
        const reverseDemands = calcCabinDemands(sched.to, sched.from);
        for (let k in plane.cabin) {
            if (plane.cabin[k] > 0) {
                const cap = plane.cabin[k] * ac.seatsPerRow[k];
                totalPax += Math.min(cap, reverseDemands[k]);
            }
        }
        plane._paxReturn = totalPax;

        const flightNo = getFlightNo(sched, roundIdx, true);
        const reverseExists = routeExists(sched.to, sched.from);
        pushFlightEvent({
            time: timeStr,
            flightNo: flightNo,
            plane: plane.name,
            from: sched.to,
            to: sched.from,
            type: 'dep',
            empty: !reverseExists
        });

    } else if (local === 3) {
        const flightNo = getFlightNo(sched, roundIdx, true);
        const reverseExists = routeExists(sched.to, sched.from);
        const baseFare = calcBaseFare(sched.to, sched.from);

        let revenue = 0;
        let totalPax = 0;

        if (reverseExists) {
            const reverseDemands = calcCabinDemands(sched.to, sched.from);
            for (let k in plane.cabin) {
                if (plane.cabin[k] > 0) {
                    const cap = plane.cabin[k] * ac.seatsPerRow[k];
                    const sold = Math.min(cap, reverseDemands[k]);
                    totalPax += sold;
                    revenue += sold * baseFare * CABIN_RULES[k].fare;
                }
            }
        }

        const cost = calcSegmentCost(plane.type, dur.distance);
        const net = revenue - cost.total;

        changeMoney(net, `航班收益 (${flightNo})`);

        pushFlightEvent({
            time: timeStr,
            flightNo: flightNo,
            plane: plane.name,
            from: sched.to,
            to: sched.from,
            type: 'arr',
            amount: revenue,
            cost: cost.total,
            empty: !reverseExists,
            pax: totalPax
        });
        addTodayFlight(revenue);
        addReputation(repDelta);
        accumulateFh(plane, fhDelta);
    }
}

function fmtTimeFromMs(ms) {
    const d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// ==================== 航班动态栏 ====================

function pushFlightEvent(evt) {
    flightEvents.push(evt);
    while (flightEvents.length > FLIGHT_EVENT_MAX) {
        flightEvents.shift();
    }
    renderFlightList();
}

function renderFlightList() {
    const list = document.getElementById('flight-list');
    if (!list) return;

    if (flightEvents.length === 0) {
        list.innerHTML = '<div class="fb-empty">暂无航班</div>';
        return;
    }

    let html = '';
    flightEvents.forEach(function (e) {
        if (e.type === 'maint') {
            html +=
                '<div class="fb-row fb-maint-row">' +
                    '<span class="fb-time">' + e.time + '</span>' +
                    '<span class="fb-plane">' + e.plane + '</span>' +
                    '<span class="fb-tag fb-maint">需 ' + e.level + ' 检</span>' +
                '</div>';
            return;
        }

        const isDep = e.type === 'dep';
        const tagCls = isDep ? 'fb-dep' : 'fb-arr';
        const tagText = isDep ? '起飞' : '到达';

        let amountStr = '';
        if (e.amount && e.amount > 0) {
            amountStr = '<span class="fb-amount">+¥' + formatMoneyShort(e.amount).replace('¥', '') + '</span>';
        }

        let costStr = '';
        if (e.cost && e.cost > 0) {
            costStr = '<span class="fb-cost">-¥' + formatMoneyShort(e.cost).replace('¥', '') + '</span>';
        }

        if (e.empty && !e.amount) {
            amountStr = '<span class="fb-empty-tag">空飞</span>';
        }

        let paxStr = '';
        if (e.type === 'arr' && e.pax !== undefined) {
            paxStr = '<span class="fb-pax">' + e.pax +
                '<span class="unit">人</span></span>';
        }

        const noStr = e.flightNo ? '<span class="fb-no">' + e.flightNo + '</span>' : '';

        html +=
            '<div class="fb-row">' +
                '<span class="fb-time">' + e.time + '</span>' +
                noStr +
                '<span class="fb-plane">' + e.plane + '</span>' +
                '<span class="fb-route">' + e.from + '→' + e.to + '</span>' +
                '<span class="fb-tag ' + tagCls + '">' + tagText + '</span>' +
                paxStr +
                amountStr +
                costStr +
            '</div>';
    });
    list.innerHTML = html;
    list.scrollTop = list.scrollHeight;
}

// ==================== 时刻表弹窗 ====================

function openScheduleModal(planeIdx) {
    const plane = gameState.fleet[planeIdx];
    if (!plane) return;

    if (isUnderMaintenance(plane)) {
        showToast('检修中的飞机无法修改时刻表');
        return;
    }

    if (!isPlaneAtHome(plane)) {
        showToast('飞机不在基地，无法修改时刻表');
        return;
    }

    editingSchedulePlaneIdx = planeIdx;

    if (plane.schedule) {
        editingScheduleRouteKey = plane.schedule.from + '-' + plane.schedule.to;
    } else {
        editingScheduleRouteKey = null;
    }

    document.getElementById('sch-plane-name').textContent = plane.name;
    const data = getAircraftData(plane.type);
    document.getElementById('sch-plane-type').textContent =
        data.displayName + ' · ' + getPlaneTotalSeats(plane) + ' 座';
    document.getElementById('sch-plane-loc').textContent = getPlaneLocationText(plane);

    if (schRouteSelectCtrl) {
        if (editingScheduleRouteKey) {
            var label = scheduleRouteLabel(editingScheduleRouteKey);
            schRouteSelectCtrl.setSelected(editingScheduleRouteKey, label);
        } else {
            schRouteSelectCtrl.reset();
        }
    }

    const firstDepInput = document.getElementById('sch-firstdep-input');
    if (plane.schedule) {
        document.getElementById('sch-flights-input').value = plane.schedule.flightsPerDay;
        firstDepInput.value = minToHHMM(plane.schedule.firstDepartMin || 0);
    } else {
        document.getElementById('sch-flights-input').value = 1;
        firstDepInput.value = '00:00';
    }

    updateScheduleUI();
    openOverlay('schedule-overlay');
}

function closeScheduleModal() {
    if (schRouteSelectCtrl) schRouteSelectCtrl.close();
    editingSchedulePlaneIdx = -1;
    editingScheduleRouteKey = null;
    closeOverlay('schedule-overlay');
}

function onScheduleOverlayClick(event) {
    if (schRouteSelectCtrl && schRouteSelectCtrl.isOpen()) {
        schRouteSelectCtrl.close();
        return;
    }
    if (event.target.id === 'schedule-overlay') {
        closeScheduleModal();
    }
}

function isPlaneAtHome(plane) {
    if (!plane.schedule) return true;

    const sched = plane.schedule;
    const dur = calcFlightDuration(sched.from, sched.to, plane.type);
    if (!dur) return true;

    const firstMin = sched.firstDepartMin || 0;

    const d = new Date(gameTimeMs);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const elapsedMin = (gameTimeMs - dayStart) / 60000;
    const totalEndMin = firstMin + sched.flightsPerDay * dur.roundMin;

    if (elapsedMin < firstMin) return true;
    if (elapsedMin >= totalEndMin) return true;

    const localElapsed = elapsedMin - firstMin;
    const roundElapsed = localElapsed - Math.floor(localElapsed / dur.roundMin) * dur.roundMin;
    return roundElapsed >= 2 * dur.flightMin + dur.turnTo;
}

function getPlaneLocationText(plane) {
    if (plane.maintenanceUntilMs > 0) {
        var remainMs = plane.maintenanceUntilMs - gameTimeMs;
        if (remainMs < 0) remainMs = 0;
        var remainDays = Math.ceil(remainMs / MS_PER_DAY);
        return '检修中 · 剩余 ' + remainDays + ' 天';
    }

    if (plane.pendingCheck) {
        return '待检修 · 需 ' + plane.pendingCheck + ' 检';
    }

    if (!plane.schedule) {
        const home = AIRPORT_GCJ.find(function (a) { return a.iata === plane.home; });
        return home ? home.name + ' ' + home.iata : '—';
    }

    const sched = plane.schedule;
    const dur = calcFlightDuration(sched.from, sched.to, plane.type);
    if (!dur) return '—';

    const a = AIRPORT_GCJ.find(function (x) { return x.iata === sched.from; });
    const b = AIRPORT_GCJ.find(function (x) { return x.iata === sched.to; });

    const firstMin = sched.firstDepartMin || 0;

    const d = new Date(gameTimeMs);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const elapsedMin = (gameTimeMs - dayStart) / 60000;
    const totalEndMin = firstMin + sched.flightsPerDay * dur.roundMin;

    if (elapsedMin < firstMin) return a.name + ' ' + a.iata;
    if (elapsedMin >= totalEndMin) return a.name + ' ' + a.iata;

    const localElapsed = elapsedMin - firstMin;
    const roundElapsed = localElapsed - Math.floor(localElapsed / dur.roundMin) * dur.roundMin;

    if (roundElapsed < dur.flightMin) return '执飞 ' + sched.from + ' → ' + sched.to;
    else if (roundElapsed < dur.flightMin + dur.turnTo) return b.name + ' ' + b.iata;
    else if (roundElapsed < 2 * dur.flightMin + dur.turnTo) return '执飞 ' + sched.to + ' → ' + sched.from;
    else return a.name + ' ' + a.iata;
}

function scheduleRouteLabel(key) {
    const parts = key.split('-');
    const a = AIRPORT_GCJ.find(function (x) { return x.iata === parts[0]; });
    const b = AIRPORT_GCJ.find(function (x) { return x.iata === parts[1]; });
    if (!a || !b) return key;
    return a.name + ' ' + a.iata + ' → ' + b.name + ' ' + b.iata;
}

function updateScheduleUI() {
    const input = document.getElementById('sch-flights-input');
    const hint = document.getElementById('sch-hint');
    const saveBtn = document.getElementById('sch-save-btn');
    const previewBox = document.getElementById('sch-preview');

    const firstDepInput = document.getElementById('sch-firstdep-input');
    const firstDepHint = document.getElementById('sch-firstdep-hint');

    const flights = parseInt(input.value, 10) || 0;

    if (!editingScheduleRouteKey) {
        input.classList.remove('error');
        hint.classList.remove('error');
        hint.textContent = '请先选择航线';
        saveBtn.disabled = true;
        firstDepInput.classList.remove('error');
        firstDepHint.classList.remove('error');
        firstDepHint.textContent = '格式 HH:MM';
        document.getElementById('sch-di-flight').textContent = '—';
        document.getElementById('sch-di-turn').textContent = '—';
        document.getElementById('sch-di-round').textContent = '—';
        previewBox.innerHTML = '<div class="pv-empty">暂无时刻</div>';
        return;
    }

    const plane = gameState.fleet[editingSchedulePlaneIdx];
    const aircraftType = plane ? plane.type : null;

    const parts = editingScheduleRouteKey.split('-');
    const dur = calcFlightDuration(parts[0], parts[1], aircraftType);
    if (!dur) return;

    document.getElementById('sch-di-flight').textContent = fmtMin(dur.flightMin) + ' × 2';
    document.getElementById('sch-di-turn').textContent = fmtMin(dur.turnFrom) + ' + ' + fmtMin(dur.turnTo);
    document.getElementById('sch-di-round').textContent = fmtMin(dur.roundMin);

    const firstMin = parseHHMM(firstDepInput.value);
    const firstDepValid = (firstMin !== null);

    let flightsValid = true;
    if (flights < 1) {
        flightsValid = false;
        input.classList.add('error');
        hint.classList.add('error');
        hint.textContent = '至少 1 趟';
    } else {
        input.classList.remove('error');
        hint.classList.remove('error');
    }

    if (!firstDepValid) {
        firstDepInput.classList.add('error');
        firstDepHint.classList.add('error');
        firstDepHint.textContent = '格式 HH:MM（00:00 ~ 23:59）';
    } else {
        firstDepInput.classList.remove('error');
        firstDepHint.classList.remove('error');
        firstDepHint.textContent = '格式 HH:MM';
    }

    if (flightsValid && firstDepValid) {
        const endMin = firstMin + flights * dur.roundMin;
        const maxF = Math.floor((1439 - firstMin) / dur.roundMin);

        if (endMin > 1439) {
            input.classList.add('error');
            hint.classList.add('error');
            hint.textContent = '末班落地 ' + minToHHMM(endMin) + '，超出当天。最多 ' + maxF + ' 趟，或提前首班';
            saveBtn.disabled = true;
        } else {
            hint.classList.remove('error');
            hint.textContent = '系统推荐：最多 ' + maxF + ' 趟';
            saveBtn.disabled = false;
        }

        renderSchedulePreview(editingScheduleRouteKey, flights, aircraftType, firstMin);
    } else {
        saveBtn.disabled = true;
        previewBox.innerHTML = '<div class="pv-empty">暂无时刻</div>';
    }
}

function renderSchedulePreview(routeKey, flights, aircraftType, firstMin) {
    const parts = routeKey.split('-');
    const from = parts[0];
    const to = parts[1];

    const dur = calcFlightDuration(from, to, aircraftType);
    if (!dur) return;

    const hasReverse = routeExists(to, from);

    const box = document.getElementById('sch-preview');
    let html = '';
    let t = firstMin || 0;

    for (let i = 0; i < flights; i++) {
        html +=
            '<div class="pv-row">' +
                '<span class="pv-time">' + fmtTimeOfDay(t) + '</span>' +
                '<span class="pv-route">' + from + ' → ' + to + '<span class="pv-tag paid">载客</span></span>' +
            '</div>';
        t += dur.flightMin + dur.turnTo;

        const tag = hasReverse ? '<span class="pv-tag paid">载客</span>' : '<span class="pv-tag empty">空飞</span>';
        html +=
            '<div class="pv-row">' +
                '<span class="pv-time">' + fmtTimeOfDay(t) + '</span>' +
                '<span class="pv-route">' + to + ' → ' + from + tag + '</span>' +
            '</div>';
        t += dur.flightMin + dur.turnFrom;
    }

    if (html === '') html = '<div class="pv-empty">暂无时刻</div>';
    box.innerHTML = html;
}

function saveSchedule(btn) {
    if (btn.disabled) return;
    if (!editingScheduleRouteKey) return;
    if (btn.classList.contains('pressed')) return;
    btn.classList.add('pressed');

    setTimeout(function () {
        btn.classList.remove('pressed');
        const plane = gameState.fleet[editingSchedulePlaneIdx];
        if (!plane) return;

        const flights = parseInt(document.getElementById('sch-flights-input').value, 10) || 0;
        if (flights < 1) return;

        const firstMin = parseHHMM(document.getElementById('sch-firstdep-input').value);
        if (firstMin === null) return;

        const parts = editingScheduleRouteKey.split('-');

        plane.schedule = {
            from: parts[0],
            to: parts[1],
            flightsPerDay: flights,
            firstDepartMin: firstMin
        };

        plane._state = null;
        plane._paxOutbound = undefined;
        plane._paxReturn = undefined;

        closeScheduleModal();
        renderFleet();
        updateSinglePlane(plane);

        showToast('时刻表已保存');
    }, 200);
}

// ==================== 航线 tab ====================

function renderRouteTab() {
    const list = document.getElementById('route-tab-list');
    if (!list) return;

    if (routes.length === 0) {
        list.innerHTML = '<div class="fleet-empty">暂无航线，点右上角建立</div>';
        return;
    }

    let html = '';
    routes.forEach(function (r, idx) {
        const fare = calcBaseFare(r.from, r.to);
        const demand = calcRouteDemandShared(r.from, r.to);
        const demandTotal = demand ? Math.round(demand.total) : 0;
        const dist = demand ? Math.round(demand.distance) : 0;

        html +=
            '<div class="route-card" data-route-idx="' + idx + '">' +
                '<div class="rc-top">' +
                    '<div class="rc-name">' + r.fromName + ' ' + r.from + '<span class="rc-arrow"> → </span>' + r.toName + ' ' + r.to + '</div>' +
                    '<span class="rc-index">' + demandTotal + ' 人次/日</span>' +
                '</div>' +
                '<div class="rc-info">航距 <b>' + dist + '</b> km · 票价 <b>¥' + fare.toLocaleString('en-US') + '</b></div>' +
            '</div>';
    });
    list.innerHTML = html;

    list.querySelectorAll('.route-card').forEach(function (card) {
        card.onclick = function () {
            const idx = parseInt(this.getAttribute('data-route-idx'), 10);
            openRouteDetail(routes[idx]);
        };
    });
}

// ==================== 机场 tab ====================

function renderAirportTab() {
    const list = document.getElementById('airport-tab-list');
    if (!list) return;

    const sorted = AIRPORT_GCJ.slice().sort(function (a, b) {
        return b.airportIndex - a.airportIndex;
    });

    let html = '';
    sorted.forEach(function (a) {
        let tags = '';
        if (a.isHighPlateau) {
            tags = '<div class="ac-tags"><span class="ac-tag high">高高原</span></div>';
        } else if (a.isPlateau) {
            tags = '<div class="ac-tags"><span class="ac-tag plateau">高原</span></div>';
        }

        html +=
            '<div class="airport-card" data-iata="' + a.iata + '">' +
                '<div class="ac-top">' +
                    '<div><span class="ac-name">' + a.name + '</span><span class="ac-iata">' + a.iata + '</span></div>' +
                    '<span class="ac-index">' + a.airportIndex.toFixed(1) + '</span>' +
                '</div>' +
                '<div class="ac-info">' +
                    '<span>' + a.throughput.toLocaleString('en-US') + ' 万</span><span class="dot">·</span>' +
                    '<span>' + a.grade + '</span><span class="dot">·</span>' +
                    '<span>距市 <b>' + a.distance + '</b> km</span>' +
                '</div>' +
                tags +
            '</div>';
    });
    list.innerHTML = html;

    list.querySelectorAll('.airport-card').forEach(function (card) {
        card.onclick = function () {
            openAirportPanel(this.getAttribute('data-iata'));
        };
    });
}

// ==================== 航线 Picker ====================

function openRoutePicker() {
    routePickerFrom = null;
    routePickerTo = null;

    if (rpFromSelectCtrl) rpFromSelectCtrl.reset();
    if (rpToSelectCtrl) rpToSelectCtrl.reset();

    updateRoutePickerNextBtn();
    openOverlay('route-picker-overlay');
}

function closeRoutePicker() {
    if (rpFromSelectCtrl) rpFromSelectCtrl.close();
    if (rpToSelectCtrl) rpToSelectCtrl.close();
    closeOverlay('route-picker-overlay');
}

function onRoutePickerOverlayClick(event) {
    if (rpFromSelectCtrl && rpFromSelectCtrl.isOpen()) {
        rpFromSelectCtrl.close();
        return;
    }
    if (rpToSelectCtrl && rpToSelectCtrl.isOpen()) {
        rpToSelectCtrl.close();
        return;
    }
    if (event.target.id === 'route-picker-overlay') {
        closeRoutePicker();
    }
}

function updateRoutePickerNextBtn() {
    const btn = document.getElementById('rp-next-btn');
    if (!btn) return;
    const ok = routePickerFrom && routePickerTo && routePickerFrom !== routePickerTo;
    btn.disabled = !ok;
}

function routePickerNext(btn) {
    if (btn && btn.disabled) return;
    if (!routePickerFrom || !routePickerTo) return;

    const from = AIRPORT_GCJ.find(function (a) { return a.iata === routePickerFrom; });
    const to = AIRPORT_GCJ.find(function (a) { return a.iata === routePickerTo; });
    if (!from || !to) return;

    const distKm = calcDistanceKm(from.lat, from.lng, to.lat, to.lng);
    if (distKm <= 200) {
        showToast('航线太短，无法创建');
        return;
    }

    if (routeExists(routePickerFrom, routePickerTo)) {
        showToast('已有该航线！');
        return;
    }

    const demand = calcRouteDemandShared(routePickerFrom, routePickerTo);
    if (demand) {
        demand.from = routePickerFrom;
        demand.to = routePickerTo;
    }

    document.getElementById('rt-from-name').textContent = from.name;
    document.getElementById('rt-from-iata').textContent = from.iata;
    document.getElementById('rt-to-name').textContent = to.name;
    document.getElementById('rt-to-iata').textContent = to.iata;
    document.getElementById('rt-demand').innerHTML = buildRouteDemandHTML(demand);

    const openFee = calcRouteOpenFee(distKm);
    const createBtn = document.getElementById('rt-create-btn');
    if (createBtn) {
        if (gameState.money >= openFee) {
            createBtn.disabled = false;
            createBtn.textContent = '+ 建立';
        } else {
            createBtn.disabled = true;
            createBtn.textContent = '资金不足';
        }
    }

    closeRoutePicker();
    openOverlay('route-tab-demand-overlay');
}

function closeRouteTabDemand() {
    closeOverlay('route-tab-demand-overlay');
}

function confirmRouteTabCreate(btn) {
    if (btn && btn.disabled) return;
    if (btn && btn.classList.contains('pressed')) return;
    if (btn) btn.classList.add('pressed');

    setTimeout(function () {
        if (btn) btn.classList.remove('pressed');
        if (!routePickerFrom || !routePickerTo) return;

        const from = AIRPORT_GCJ.find(function (a) { return a.iata === routePickerFrom; });
        const to = AIRPORT_GCJ.find(function (a) { return a.iata === routePickerTo; });
        if (!from || !to) return;

        const distKm = calcDistanceKm(from.lat, from.lng, to.lat, to.lng);
        const openFee = calcRouteOpenFee(distKm);

        if (gameState.money < openFee) {
            showToast('资金不足');
            return;
        }

        changeMoney(-openFee, `开通航线：${from.iata}-${to.iata}`);

        drawRoute(from, to);
        addReputation(openFee / 100000000);

        renderRouteTab();
        renderAirlinePanel();

        closeRouteTabDemand();

        routePickerFrom = null;
        routePickerTo = null;
    }, 200);
}

// ==================== 返回标题彩蛋 ====================

function openReturnTitle() {
    if (!gameMap) return;
    openOverlay('return-title-overlay');
}

function closeReturnTitle() {
    closeOverlay('return-title-overlay');
}

function confirmReturnTitle() {
    closeReturnTitle();
    closePlaneDetail();
    clearAllRoutes();
    clearAllPlaneMarkers();

    flightEvents.length = 0;
    renderFlightList();

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
    refreshAllAirportDots();

    renderFleet();
    renderRouteTab();
    renderAirlinePanel();

    bgAnimating = true;
    requestAnimationFrame(bgLoop);
}

// ==================== 二手市场生成逻辑 ====================

function generateUsedPlane() {
    const aircraftList = Object.values(AIRCRAFT_DATA);
    const ac = aircraftList[Math.floor(Math.random() * aircraftList.length)];

    const age = 1 + Math.random() * 14;
    const fh = Math.floor(age * 3000 + (Math.random() * 1000 - 500));
    
    const baseD = Math.floor(fh / 10000) * 10000 + 10000;
    const nextDCheck = baseD - fh;

    let cabin = { P: 0, F: 0, C: 0, W: 0, Y: 0 };
    const layoutRoll = Math.random();
    if (layoutRoll < 0.3) {
        cabin.Y = Math.floor(ac.maxRows);
    } else if (layoutRoll < 0.8) {
        cabin.C = Math.floor(ac.maxRows * 0.1);
        let used = cabin.C * CABIN_RULES.C.rows;
        cabin.Y = Math.floor((ac.maxRows - used) / CABIN_RULES.Y.rows);
    } else {
        cabin.P = Math.random() > 0.5 ? 1 : 0;
        cabin.F = Math.floor(ac.maxRows * 0.05);
        cabin.C = Math.floor(ac.maxRows * 0.15);
        let used = cabin.P*4 + cabin.F*3 + cabin.C*2;
        cabin.Y = Math.floor((ac.maxRows - used) / CABIN_RULES.Y.rows);
    }

    let price = ac.newPrice * Math.pow(0.94, age);
    
    if (nextDCheck < 3000) price *= 0.7;
    if (nextDCheck < 1000) price *= 0.7;

    if (cabin.P === 0 && cabin.F === 0 && cabin.W === 0) price *= 1.05;

    return {
        type: ac.shortName,
        displayName: ac.displayName,
        origPrice: ac.newPrice,
        age: age,
        fh: fh,
        nextACheckFh: Math.ceil(fh / 300) * 300,
        nextCCheckFh: Math.ceil(fh / 3000) * 3000,
        nextDCheckFh: baseD,
        nextDCheck: nextDCheck,
        cabin: cabin,
        price: Math.round(price)
    };
}

function refreshSecondhandMarket() {
    while (secondhandMarket.length < 10) {
        secondhandMarket.push(generateUsedPlane());
    }
    if (secondhandMarket.length > 12) {
        secondhandMarket = secondhandMarket.slice(-12);
    }
}

function onMonthChangeForMarket() {
    refreshSecondhandMarket();
    showToast('二手市场已更新');
}

function initSecondhandMarket(loadData) {
    if (loadData && loadData.secondhandMarket) {
        secondhandMarket = loadData.secondhandMarket;
    } else {
        secondhandMarket = [];
        refreshSecondhandMarket();
    }
}

// ==================== 全局点击：关闭下拉 ====================

document.addEventListener('click', function (e) {
    [homeSelectCtrl, rpFromSelectCtrl, rpToSelectCtrl, schRouteSelectCtrl].forEach(function (ctrl) {
        if (!ctrl || !ctrl.isOpen()) return;
        var el = ctrl.getElement();
        if (el && el.contains(e.target)) return;
        ctrl.close();
    });
});

// ==================== 初始化 ====================

function initSearchSelectsBoot() {
    initSearchSelects();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        setTimeout(initSearchSelectsBoot, 150);
    });
} else {
    setTimeout(initSearchSelectsBoot, 150);
}

// ==================== 顶栏 logo 彩蛋 ====================

document.addEventListener('DOMContentLoaded', function () {
    const logo = document.getElementById('top-logo');
    if (logo) {
        logo.addEventListener('click', function () {
            openReturnTitle();
        });
    }
});
