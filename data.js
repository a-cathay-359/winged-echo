// SPDX-License-Identifier: AGPL-3.0-or-later
// 翼掠惊鸿 - 数据层

// ==================== 坐标转换 ====================

const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lng, lat) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
    return ret;
}

function transformLng(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
    return ret;
}

function wgs84ToGcj02(lng, lat) {
    if (outOfChina(lng, lat)) return [lng, lat];
    let dLat = transformLat(lng - 105.0, lat - 35.0);
    let dLng = transformLng(lng - 105.0, lat - 35.0);
    const radLat = lat / 180.0 * PI;
    let magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
    dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
    return [lng + dLng, lat + dLat];
}

// ==================== 客舱配置常量 ====================

// 舱位属性：占几排纵向空间，票价倍数
const CABIN_RULES = {
    P: { rows: 4.0, fare: 6.0 }, // 豪华头等
    F: { rows: 3.0, fare: 3.5 }, // 头等
    C: { rows: 2.0, fare: 2.0 }, // 商务
    W: { rows: 1.5, fare: 1.4 }, // 超经
    Y: { rows: 1.0, fare: 1.0 }  // 经济
};

// ==================== 飞机数据 ====================

// 注：seatCapacity 已废弃，由 seatsPerRow 和 maxRows 替代。
// seatsPerRow 里面定义了该机型在不同舱位下，单排横向能塞几个座位。
const AIRCRAFT_DATA = {
    A320neo: {
        name: "空客 A320neo (LEAP-1A)",
        shortName: "A320neo",
        displayName: "空客 A320neo",
        maxRows: 30, // 最大纵向排数
        seatsPerRow: { P: 2, F: 2, C: 4, W: 6, Y: 6 },
        cruiseSpeed: 850, range: 6200, mtow: 79000, maxPayload: 20.0, fuelCapacity: 26000, cruiseFuelBurn: 2.94,
        newPrice: 430000000, wakeCategory: "M", reputationRate: 0.01
    },
    B737_800: {
        name: "波音 737-800 (CFM56-7B)",
        shortName: "738",
        displayName: "波音 737-800",
        maxRows: 30,
        seatsPerRow: { P: 2, F: 2, C: 4, W: 6, Y: 6 },
        cruiseSpeed: 850, range: 5765, mtow: 79000, maxPayload: 20.0, fuelCapacity: 26020, cruiseFuelBurn: 3.25,
        newPrice: 370000000, wakeCategory: "M", reputationRate: 0.01
    },
    B737_MAX8: {
        name: "波音 737 MAX 8 (LEAP-1B)",
        shortName: "78M",
        displayName: "波音 737 MAX 8",
        maxRows: 31,
        seatsPerRow: { P: 2, F: 2, C: 4, W: 6, Y: 6 },
        cruiseSpeed: 850, range: 6570, mtow: 82200, maxPayload: 20.8, fuelCapacity: 25810, cruiseFuelBurn: 3.10,
        newPrice: 460000000, wakeCategory: "M", reputationRate: 0.01
    },
    A321ceo: {
        name: "空客 A321ceo (CFM56-5B)",
        shortName: "321",
        displayName: "空客 A321ceo",
        maxRows: 36,
        seatsPerRow: { P: 2, F: 2, C: 4, W: 6, Y: 6 },
        cruiseSpeed: 850, range: 5950, mtow: 93500, maxPayload: 20.0, fuelCapacity: 30030, cruiseFuelBurn: 3.60,
        newPrice: 550000000, wakeCategory: "M", reputationRate: 0.01
    },
    A321neo: {
        name: "空客 A321neo (LEAP-1A)",
        shortName: "21N",
        displayName: "空客 A321neo",
        maxRows: 38,
        seatsPerRow: { P: 2, F: 2, C: 4, W: 6, Y: 6 },
        cruiseSpeed: 850, range: 7400, mtow: 97000, maxPayload: 21.4, fuelCapacity: 32940, cruiseFuelBurn: 3.20,
        newPrice: 790000000, wakeCategory: "M", reputationRate: 0.01
    },
    A321XLR: {
        name: "空客 A321XLR (LEAP-1A)",
        shortName: "21XLR",
        displayName: "空客 A321XLR",
        maxRows: 40,
        seatsPerRow: { P: 2, F: 2, C: 4, W: 6, Y: 6 },
        cruiseSpeed: 850, range: 8700, mtow: 101000, maxPayload: 23.0, fuelCapacity: 36390, cruiseFuelBurn: 3.30,
        newPrice: 870000000, wakeCategory: "M", reputationRate: 0.01
    },
    A330_300: {
        name: "空客 A330-300 (Trent 700)",
        shortName: "333",
        displayName: "空客 A330-300",
        maxRows: 42,
        seatsPerRow: { P: 3, F: 3, C: 6, W: 8, Y: 8 }, // A330 经济舱经典 2-4-2
        cruiseSpeed: 900, range: 11750, mtow: 242000, maxPayload: 45.0, fuelCapacity: 139090, cruiseFuelBurn: 7.40,
        newPrice: 1760000000, wakeCategory: "H", reputationRate: 0.015
    },
    A330_900: {
        name: "空客 A330-900neo (Trent 7000)",
        shortName: "339",
        displayName: "空客 A330-900neo",
        maxRows: 44,
        seatsPerRow: { P: 3, F: 3, C: 6, W: 8, Y: 8 },
        cruiseSpeed: 900, range: 13334, mtow: 251000, maxPayload: 45.5, fuelCapacity: 139090, cruiseFuelBurn: 7.04,
        newPrice: 2040000000, wakeCategory: "H", reputationRate: 0.015
    },
    A350_900: {
        name: "空客 A350-900 (Trent XWB)",
        shortName: "A350-900",
        displayName: "空客 A350-900",
        maxRows: 45,
        seatsPerRow: { P: 3, F: 3, C: 4, W: 9, Y: 9 }, // A350 经济舱 3-3-3，商务 1-2-1
        cruiseSpeed: 900, range: 15000, mtow: 268000, maxPayload: 50.0, fuelCapacity: 138000, cruiseFuelBurn: 6.98,
        newPrice: 2200000000, wakeCategory: "H", reputationRate: 0.015
    },
    A380_800: {
        name: "空客 A380-800 (Trent 900)",
        shortName: "380",
        displayName: "空客 A380-800",
        maxRows: 70,
        seatsPerRow: { P: 3, F: 3, C: 4, W: 9, Y: 10 }, // A380 经济舱 3-4-3
        cruiseSpeed: 950, range: 14800, mtow: 575000, maxPayload: 65.0, fuelCapacity: 320000, cruiseFuelBurn: 15.00,
        newPrice: 3100000000, wakeCategory: "J", reputationRate: 0.02
    }
};

// 辅助函数：计算某机型某客舱配置下的总座位数
function calcPlaneTotalSeats(type, cabinConfig) {
    const ac = getAircraftData(type);
    let total = 0;
    for (let k in cabinConfig) {
        if (ac.seatsPerRow[k]) {
            total += cabinConfig[k] * ac.seatsPerRow[k];
        }
    }
    return total;
}

function getAircraftData(shortName) {
    const found = Object.values(AIRCRAFT_DATA).find(function (d) {
        return d.shortName === shortName;
    });
    return found || Object.values(AIRCRAFT_DATA)[0];
}

// ==================== 机场数据 ====================

const AIRPORT_DATA = [
    { iata: "PEK", name: "北京首都", city: "北京", lat: 40.0801, lng: 116.5846,
      throughput: 7076, grade: "4F", distance: 25,   isPlateau: false, isHighPlateau: false },
    { iata: "PVG", name: "上海浦东", city: "上海", lat: 31.1443, lng: 121.8083,
      throughput: 8499, grade: "4F", distance: 30,   isPlateau: false, isHighPlateau: false },
    { iata: "CAN", name: "广州白云", city: "广州", lat: 23.3924, lng: 113.2988,
      throughput: 8359, grade: "4F", distance: 28,   isPlateau: false, isHighPlateau: false },
    { iata: "CTU", name: "成都双流", city: "成都", lat: 30.5785, lng: 103.9471,
      throughput: 3352, grade: "4F", distance: 16,   isPlateau: false, isHighPlateau: false },
    { iata: "TFU", name: "成都天府", city: "成都", lat: 30.3125, lng: 104.4417,
      throughput: 5669, grade: "4F", distance: 50,   isPlateau: false, isHighPlateau: false },
    { iata: "URC", name: "乌鲁木齐天山", city: "乌鲁木齐", lat: 43.9071, lng: 87.4742,
      throughput: 2918, grade: "4F", distance: 16.8, isPlateau: false, isHighPlateau: false },
    { iata: "SZX", name: "深圳宝安", city: "深圳", lat: 22.6393, lng: 113.8106,
      throughput: 6649, grade: "4F", distance: 32,   isPlateau: false, isHighPlateau: false },
    { iata: "KMG", name: "昆明长水", city: "昆明", lat: 25.1019, lng: 102.9292,
      throughput: 4969, grade: "4F", distance: 24.5, isPlateau: true,  isHighPlateau: false },
    { iata: "HRB", name: "哈尔滨太平", city: "哈尔滨", lat: 45.6234, lng: 126.2500,
      throughput: 2465, grade: "4E", distance: 33,   isPlateau: false, isHighPlateau: false },
    { iata: "LXA", name: "拉萨贡嘎", city: "拉萨", lat: 29.2978, lng: 90.9119,
      throughput: 628, grade: "4E", distance: 60,   isPlateau: true,  isHighPlateau: true },
    { iata: "PKX", name: "北京大兴", city: "北京", lat: 39.5098, lng: 116.4107,
      throughput: 5361, grade: "4F", distance: 46,   isPlateau: false, isHighPlateau: false },
    { iata: "SHA", name: "上海虹桥", city: "上海", lat: 31.1979, lng: 121.3363,
      throughput: 5015, grade: "4E", distance: 13,   isPlateau: false, isHighPlateau: false },
    { iata: "TSN", name: "天津滨海", city: "天津", lat: 39.126976, lng: 117.362141,
      throughput: 1847, grade: "4E", distance: 13,   isPlateau: false, isHighPlateau: false },
    { iata: "SJW", name: "石家庄正定", city: "石家庄", lat: 38.2806, lng: 114.6964,
      throughput: 645, grade: "4E", distance: 33,   isPlateau: false, isHighPlateau: false },
    { iata: "TYN", name: "太原武宿", city: "太原", lat: 37.752352, lng: 112.632995,
      throughput: 1457, grade: "4E", distance: 9,    isPlateau: false, isHighPlateau: false },
    { iata: "SHE", name: "沈阳桃仙", city: "沈阳", lat: 41.6400, lng: 123.4836,
      throughput: 2493, grade: "4E", distance: 20,   isPlateau: false, isHighPlateau: false },
    { iata: "DLC", name: "大连周水子", city: "大连", lat: 38.9656, lng: 121.5383,
      throughput: 1929, grade: "4E", distance: 10,   isPlateau: false, isHighPlateau: false },
    { iata: "CGQ", name: "长春龙嘉", city: "长春", lat: 43.996622, lng: 125.694328,
      throughput: 1776, grade: "4E", distance: 32,   isPlateau: false, isHighPlateau: false },
    { iata: "KHN", name: "南昌昌北", city: "南昌", lat: 28.8650, lng: 115.9000,
      throughput: 1127, grade: "4E", distance: 20,   isPlateau: false, isHighPlateau: false },
    { iata: "NGB", name: "宁波栎社", city: "宁波", lat: 29.8267, lng: 121.4619,
      throughput: 1613, grade: "4E", distance: 12,   isPlateau: false, isHighPlateau: false },
    { iata: "WNZ", name: "温州龙湾", city: "温州", lat: 27.907167, lng: 120.853506,
      throughput: 1169, grade: "4E", distance: 20,   isPlateau: false, isHighPlateau: false },
    { iata: "HFE", name: "合肥新桥", city: "合肥", lat: 31.985066, lng: 116.977944,
      throughput: 1248, grade: "4E", distance: 32,   isPlateau: false, isHighPlateau: false },
    { iata: "FOC", name: "福州长乐", city: "福州", lat: 25.928967, lng: 119.673864,
      throughput: 1612, grade: "4E", distance: 50,   isPlateau: false, isHighPlateau: false },
    { iata: "TNA", name: "济南遥墙", city: "济南", lat: 36.8572, lng: 117.2161,
      throughput: 2032, grade: "4E", distance: 30,   isPlateau: false, isHighPlateau: false },
    { iata: "NNG", name: "南宁吴圩", city: "南宁", lat: 22.6082667, lng: 108.1724417,
      throughput: 1401, grade: "4E", distance: 28,   isPlateau: false, isHighPlateau: false },
    { iata: "HAK", name: "海口美兰", city: "海口", lat: 19.605538, lng: 110.380451,
      throughput: 1808, grade: "4E", distance: 18,   isPlateau: false, isHighPlateau: false },
    { iata: "KWE", name: "贵阳龙洞堡", city: "贵阳", lat: 26.53861, lng: 106.80083,
      throughput: 2231, grade: "4E", distance: 11,   isPlateau: false, isHighPlateau: false },
    { iata: "LHW", name: "兰州中川", city: "兰州", lat: 36.512593, lng: 103.62005,
      throughput: 1774, grade: "4E", distance: 70,   isPlateau: true,  isHighPlateau: false },
    { iata: "XNN", name: "西宁曹家堡", city: "西宁", lat: 36.5297, lng: 102.0386,
      throughput: 703, grade: "4E", distance: 28,   isPlateau: true,  isHighPlateau: false },
    { iata: "INC", name: "银川河东", city: "银川", lat: 38.3214, lng: 106.3936,
      throughput: 986, grade: "4E", distance: 19,   isPlateau: false, isHighPlateau: false },
    { iata: "KWL", name: "桂林两江", city: "桂林", lat: 25.21944, lng: 110.03944,
      throughput: 593, grade: "4E", distance: 30,   isPlateau: false, isHighPlateau: false },
    { iata: "ZUH", name: "珠海金湾", city: "珠海", lat: 22.005756, lng: 113.381945,
      throughput: 1325, grade: "4E", distance: 40,   isPlateau: false, isHighPlateau: false },
    { iata: "SWA", name: "揭阳潮汕", city: "揭阳", lat: 23.5522, lng: 116.5031,
      throughput: 867, grade: "4E", distance: 20,   isPlateau: false, isHighPlateau: false },
    { iata: "CSX", name: "长沙黄花", city: "长沙", lat: 28.1967, lng: 113.2208,
      throughput: 3128, grade: "4F", distance: 22,   isPlateau: false, isHighPlateau: false },
    { iata: "XMN", name: "厦门高崎", city: "厦门", lat: 24.5440, lng: 118.1277,
      throughput: 2919, grade: "4E", distance: 12,   isPlateau: false, isHighPlateau: false }
];

// ==================== 城市数据 ====================

const CITY_DATA = {
    "北京":     { gdp: 52073, tourismVisitors: 3.90,  tourismRevenue: 7159, perCapitaSpend: 1836, businessIndex: 1.00 },
    "上海":     { gdp: 56709, tourismVisitors: 4.16,  tourismRevenue: 5600, perCapitaSpend: 1346, businessIndex: 1.00 },
    "深圳":     { gdp: 38700, tourismVisitors: 2.00,  tourismRevenue: 3100, perCapitaSpend: 1550, businessIndex: 0.85 },
    "广州":     { gdp: 32000, tourismVisitors: 2.64,  tourismRevenue: 3768, perCapitaSpend: 1427, businessIndex: 0.80 },
    "成都":     { gdp: 24764, tourismVisitors: 3.20,  tourismRevenue: 4526, perCapitaSpend: 1414, businessIndex: 0.60 },
    "昆明":     { gdp:  8600, tourismVisitors: 3.58,  tourismRevenue: 4015, perCapitaSpend: 1121, businessIndex: 0.40 },
    "哈尔滨":   { gdp:  6200, tourismVisitors: 2.02,  tourismRevenue: 2818, perCapitaSpend: 1395, businessIndex: 0.35 },
    "乌鲁木齐": { gdp:  4500, tourismVisitors: 1.24,  tourismRevenue: 1300, perCapitaSpend: 1048, businessIndex: 0.30 },
    "拉萨":     { gdp:  1000, tourismVisitors: 0.505, tourismRevenue:  606, perCapitaSpend: 1200, businessIndex: 0.20 },
    "天津":     { gdp: 18539, tourismVisitors: 2.72,  tourismRevenue: 3200, perCapitaSpend: 1176, businessIndex: 0.75 },
    "石家庄":   { gdp:  8651, tourismVisitors: 0.95,  tourismRevenue: 1010, perCapitaSpend: 1063, businessIndex: 0.45 },
    "太原":     { gdp:  5382, tourismVisitors: 1.00,  tourismRevenue: 1000, perCapitaSpend: 1000, businessIndex: 0.40 },
    "沈阳":     { gdp:  9100, tourismVisitors: 2.30,  tourismRevenue: 2200, perCapitaSpend:  956, businessIndex: 0.50 },
    "大连":     { gdp: 10002, tourismVisitors: 1.50,  tourismRevenue: 1500, perCapitaSpend: 1000, businessIndex: 0.55 },
    "长春":     { gdp:  8005, tourismVisitors: 1.40,  tourismRevenue: 1400, perCapitaSpend: 1000, businessIndex: 0.40 },
    "南昌":     { gdp:  8141, tourismVisitors: 1.50,  tourismRevenue: 1500, perCapitaSpend: 1000, businessIndex: 0.45 },
    "宁波":     { gdp: 18716, tourismVisitors: 1.20,  tourismRevenue: 1400, perCapitaSpend: 1167, businessIndex: 0.80 },
    "温州":     { gdp: 10213, tourismVisitors: 1.20,  tourismRevenue: 1300, perCapitaSpend: 1083, businessIndex: 0.60 },
    "合肥":     { gdp: 14210, tourismVisitors: 1.90,  tourismRevenue: 2307, perCapitaSpend: 1214, businessIndex: 0.65 },
    "福州":     { gdp: 15112, tourismVisitors: 1.40,  tourismRevenue: 1416, perCapitaSpend: 1011, businessIndex: 0.65 },
    "济南":     { gdp: 14210, tourismVisitors: 1.30,  tourismRevenue: 1399, perCapitaSpend: 1076, businessIndex: 0.60 },
    "南宁":     { gdp:  6212, tourismVisitors: 1.20,  tourismRevenue: 1300, perCapitaSpend: 1083, businessIndex: 0.45 },
    "海口":     { gdp:  2562, tourismVisitors: 0.28,  tourismRevenue:  469, perCapitaSpend: 1675, businessIndex: 0.40 },
    "贵阳":     { gdp:  6038, tourismVisitors: 1.60,  tourismRevenue: 1800, perCapitaSpend: 1125, businessIndex: 0.45 },
    "兰州":     { gdp:  3903, tourismVisitors: 1.20,  tourismRevenue: 1000, perCapitaSpend:  833, businessIndex: 0.35 },
    "西宁":     { gdp:  1914, tourismVisitors: 0.30,  tourismRevenue:  338, perCapitaSpend: 1127, businessIndex: 0.30 },
    "银川":     { gdp:  3033, tourismVisitors: 0.40,  tourismRevenue:  400, perCapitaSpend: 1000, businessIndex: 0.35 },
    "桂林":     { gdp:  2579, tourismVisitors: 1.75,  tourismRevenue: 2175, perCapitaSpend: 1243, businessIndex: 0.40 },
    "珠海":     { gdp:  4573, tourismVisitors: 0.23,  tourismRevenue:  250, perCapitaSpend: 1087, businessIndex: 0.60 },
    "揭阳":     { gdp:  2553, tourismVisitors: 0.12,  tourismRevenue:  150, perCapitaSpend: 1250, businessIndex: 0.30 },
    "长沙":     { gdp: 15737, tourismVisitors: 2.33,  tourismRevenue: 2580, perCapitaSpend: 1107, businessIndex: 0.55 },
    "厦门":     { gdp:  8980, tourismVisitors: 1.44,  tourismRevenue: 2135, perCapitaSpend: 1483, businessIndex: 0.60 }
};

// ==================== 机场指数算法 ====================

const AIRPORT_CONSTANTS = {
    GRADE_FACTOR: {
        "4F": 1.00,
        "4E": 0.90,
        "4D": 0.78,
        "4C": 0.62
    },
    DISTANCE_DIVISOR: 110,
    PLATEAU_FACTOR: 0.90,
    HIGH_PLATEAU_FACTOR: 0.85
};

function calcAirportIndex(airport) {
    const gradeFactor = AIRPORT_CONSTANTS.GRADE_FACTOR[airport.grade] || 0.62;
    const distanceFactor = Math.max(0, 1 - airport.distance / AIRPORT_CONSTANTS.DISTANCE_DIVISOR);

    let altitudeFactor = 1.00;
    if (airport.isHighPlateau) {
        altitudeFactor = AIRPORT_CONSTANTS.HIGH_PLATEAU_FACTOR;
    } else if (airport.isPlateau) {
        altitudeFactor = AIRPORT_CONSTANTS.PLATEAU_FACTOR;
    }

    return Math.sqrt(airport.throughput) * gradeFactor * distanceFactor * altitudeFactor;
}

// ==================== 航线人数算法 ====================

const ROUTE_CONSTANTS = {
    TOURISM_DECAY: 500,
    BUSINESS_DECAY: 900,
    TOURISM_FLOOR: 0.15,
    BUSINESS_FLOOR: 0.40,
    K_TOURISM: 0.5424,
    K_BUSINESS: 0.18792
};

const EARTH_RADIUS_KM = 6371;

function calcDistanceKm(lat1, lng1, lat2, lng2) {
    const toRad = PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function calcCityTourismAttraction(city) {
    return city.tourismRevenue * (city.perCapitaSpend / 1000);
}

function calcCityBusinessAttraction(city) {
    return city.gdp * city.businessIndex;
}

function calcDemandFromCoords(lat1, lng1, city1, lat2, lng2, city2) {
    const cA = CITY_DATA[city1];
    const cB = CITY_DATA[city2];
    if (!cA || !cB) return null;

    const distance = calcDistanceKm(lat1, lng1, lat2, lng2);

    const tourismBase = Math.sqrt(
        calcCityTourismAttraction(cA) * calcCityTourismAttraction(cB)
    );
    const businessBase = Math.sqrt(
        calcCityBusinessAttraction(cA) * calcCityBusinessAttraction(cB)
    );

    const tourismDecay = Math.max(
        ROUTE_CONSTANTS.TOURISM_FLOOR,
        1 - Math.exp(-distance / ROUTE_CONSTANTS.TOURISM_DECAY)
    );
    const businessDecay = Math.max(
        ROUTE_CONSTANTS.BUSINESS_FLOOR,
        1 - Math.exp(-distance / ROUTE_CONSTANTS.BUSINESS_DECAY)
    );

    const tourism = tourismBase * tourismDecay * ROUTE_CONSTANTS.K_TOURISM;
    const business = businessBase * businessDecay * ROUTE_CONSTANTS.K_BUSINESS;

    return {
        distance: distance,
        tourism: tourism,
        business: business,
        total: tourism + business
    };
}

function getCityCenter(city) {
    const airports = AIRPORT_GCJ.filter(function (a) {
        return a.city === city;
    });
    if (airports.length === 0) return null;

    let sumLat = 0;
    let sumLng = 0;
    airports.forEach(function (a) {
        sumLat += a.lat;
        sumLng += a.lng;
    });

    return {
        lat: sumLat / airports.length,
        lng: sumLng / airports.length
    };
}

function calcCityPairDemand(cityA, cityB) {
    const cA = getCityCenter(cityA);
    const cB = getCityCenter(cityB);
    if (!cA || !cB) return null;
    return calcDemandFromCoords(cA.lat, cA.lng, cityA, cB.lat, cB.lng, cityB);
}

function calcRouteDemand(iataA, iataB) {
    const a = AIRPORT_GCJ.find(function (x) { return x.iata === iataA; });
    const b = AIRPORT_GCJ.find(function (x) { return x.iata === iataB; });
    if (!a || !b) return null;
    return calcDemandFromCoords(a.lat, a.lng, a.city, b.lat, b.lng, b.city);
}

function calcRouteDemandShared(iataA, iataB, extraRoutes) {
    const a = AIRPORT_GCJ.find(function (x) { return x.iata === iataA; });
    const b = AIRPORT_GCJ.find(function (x) { return x.iata === iataB; });
    if (!a || !b) return null;

    const cityDemand = calcCityPairDemand(a.city, b.city);
    if (!cityDemand) return null;

    const allRoutes = [];

    if (typeof routes !== 'undefined' && routes) {
        routes.forEach(function (r) {
            allRoutes.push({ from: r.from, to: r.to });
        });
    }

    if (extraRoutes) {
        extraRoutes.forEach(function (r) {
            allRoutes.push({ from: r.from, to: r.to });
        });
    }

    const peers = [];
    allRoutes.forEach(function (r) {
        const ra = AIRPORT_GCJ.find(function (x) { return x.iata === r.from; });
        const rb = AIRPORT_GCJ.find(function (x) { return x.iata === r.to; });
        if (!ra || !rb) return;
        if (ra.city === a.city && rb.city === b.city) {
            peers.push(r);
        }
    });

    let hasSelf = false;
    peers.forEach(function (r) {
        if (r.from === iataA && r.to === iataB) hasSelf = true;
    });
    if (!hasSelf) {
        peers.push({ from: iataA, to: iataB });
    }

    let totalWeight = 0;
    let myWeight = 0;
    peers.forEach(function (r) {
        const ra = AIRPORT_GCJ.find(function (x) { return x.iata === r.from; });
        const rb = AIRPORT_GCJ.find(function (x) { return x.iata === r.to; });
        if (!ra || !rb) return;
        const w = ra.airportIndex * rb.airportIndex;
        totalWeight += w;
        if (r.from === iataA && r.to === iataB) {
            myWeight = w;
        }
    });

    const share = totalWeight > 0 ? (myWeight / totalWeight) : 1;
    const airportDist = calcDistanceKm(a.lat, a.lng, b.lat, b.lng);

    return {
        distance: airportDist,
        total: cityDemand.total * share,
        tourism: cityDemand.tourism * share,
        business: cityDemand.business * share,
        share: share
    };
}

// ==================== 分舱需求拆分 ====================

// 拆分常量：高舱位吃商务客的比例
const CABIN_DEMAND_SPLIT = {
    P: 0.02, // 极少数土豪
    F: 0.08,
    C: 0.35,
    W: 0.20  // 超经吃部分商务客（公司报销额度不够的），也吃部分高端旅游客
};

/**
 * 计算一条航线上，每个舱位的单趟潜在需求。
 * @param {string} iataA 出发地
 * @param {string} iataB 到达地
 * @returns {Object} { P, F, C, W, Y }
 */
function calcCabinDemands(iataA, iataB) {
    const demand = calcRouteDemandShared(iataA, iataB);
    if (!demand) return { P: 0, F: 0, C: 0, W: 0, Y: 0 };

    const b = demand.business;
    const t = demand.tourism;

    // P、F、C 主要吃商务客
    const pDemand = Math.round(b * CABIN_DEMAND_SPLIT.P);
    const fDemand = Math.round(b * CABIN_DEMAND_SPLIT.F);
    const cDemand = Math.round(b * CABIN_DEMAND_SPLIT.C);

    // W 超经：吃商务客剩余的 + 一部分有消费能力的旅游客
    const wDemand = Math.round(b * CABIN_DEMAND_SPLIT.W + t * 0.05);

    // Y 经济：剩下的所有旅游客 + 没买到商务舱的商务客
    const yDemand = Math.round(t * 0.95 + b * (1 - CABIN_DEMAND_SPLIT.P - CABIN_DEMAND_SPLIT.F - CABIN_DEMAND_SPLIT.C - CABIN_DEMAND_SPLIT.W));

    return {
        P: Math.max(0, pDemand),
        F: Math.max(0, fDemand),
        C: Math.max(0, cDemand),
        W: Math.max(0, wDemand),
        Y: Math.max(0, yDemand)
    };
}

// ==================== 基准票价算法 ====================

const AIRFARE_CONSTANTS = {
    LOG_BASE: 150,
    DISTANCE_FACTOR: 0.6,
    NORMAL_COEFF: 1.1,
    HIGHLAND_COEFF: 1.3,
    ROUND_UNIT: 10
};

function calcBaseFare(iataA, iataB) {
    const a = AIRPORT_GCJ.find(function (x) { return x.iata === iataA; });
    const b = AIRPORT_GCJ.find(function (x) { return x.iata === iataB; });

    if (!a || !b) return 0;

    const distance = calcDistanceKm(a.lat, a.lng, b.lat, b.lng);

    const isHighlandRoute =
        a.isPlateau || a.isHighPlateau ||
        b.isPlateau || b.isHighPlateau;

    const coeff = isHighlandRoute
        ? AIRFARE_CONSTANTS.HIGHLAND_COEFF
        : AIRFARE_CONSTANTS.NORMAL_COEFF;

    const x = distance * AIRFARE_CONSTANTS.DISTANCE_FACTOR;
    const logVal = Math.log(x) / Math.log(AIRFARE_CONSTANTS.LOG_BASE);

    const fare = logVal * distance * coeff;

    return Math.round(fare / AIRFARE_CONSTANTS.ROUND_UNIT) * AIRFARE_CONSTANTS.ROUND_UNIT;
}

// ==================== 处理后的机场数据 ====================

const AIRPORT_GCJ = AIRPORT_DATA.map(function (a) {
    const g = wgs84ToGcj02(a.lng, a.lat);
    return {
        iata: a.iata,
        name: a.name,
        city: a.city,
        lat: g[1],
        lng: g[0],
        throughput: a.throughput,
        grade: a.grade,
        distance: a.distance,
        isPlateau: a.isPlateau,
        isHighPlateau: a.isHighPlateau,
        airportIndex: calcAirportIndex(a)
    };
});

// ==================== 飞行时长算法 ====================

const GRADE_TURN = { "4F": 30, "4E": 25, "4D": 20, "4C": 20 };

const FLIGHT_CONSTANTS = {
    ACCEL_TIME: 15,
    ACCEL_DIST: 100,
    ACCEL_SPEED: 800,
    MIN_DISTANCE: 200
};

function getTurnTime(grade) {
    return GRADE_TURN[grade] || 20;
}

function calcFlightDuration(iataA, iataB, aircraftType) {
    const a = AIRPORT_GCJ.find(function (x) { return x.iata === iataA; });
    const b = AIRPORT_GCJ.find(function (x) { return x.iata === iataB; });
    if (!a || !b) return null;

    const distance = calcDistanceKm(a.lat, a.lng, b.lat, b.lng);
    const ac = getAircraftData(aircraftType);
    const cruiseSpeed = ac.cruiseSpeed;

    const cruiseDist = Math.max(0, distance - 2 * FLIGHT_CONSTANTS.ACCEL_DIST);
    const cruiseTime = cruiseDist / cruiseSpeed * 60;
    const flightMin = 2 * FLIGHT_CONSTANTS.ACCEL_TIME + cruiseTime;

    const turnFrom = getTurnTime(a.grade);
    const turnTo = getTurnTime(b.grade);
    const roundMin = flightMin * 2 + turnFrom + turnTo;

    return {
        distance: distance,
        flightMin: flightMin,
        turnFrom: turnFrom,
        turnTo: turnTo,
        roundMin: roundMin,
        cruiseSpeed: cruiseSpeed,
        cruiseDist: cruiseDist
    };
}

// ==================== 航线成本算法 ====================

const FUEL_PRICE_PER_TON = 6000;
const FUEL_DENSITY = 0.8;

function calcEnrouteFee(aircraftType, distanceKm) {
    const ac = getAircraftData(aircraftType);
    const t = ac.mtow / 1000;
    const dist = Math.max(0, distanceKm - 20);

    if (t <= 25) return 1.5 * dist;
    if (t <= 50) return 3.0 * dist;
    if (t <= 100) return 3.4 * dist;
    if (t <= 200) return 3.8 * dist;
    return 233 * dist / 100 * Math.sqrt(t / 50);
}

function calcLandingFee(aircraftType) {
    const ac = getAircraftData(aircraftType);
    const t = ac.mtow / 1000;

    if (t <= 25) return 990;
    if (t <= 50) return 1060;
    if (t <= 100) return 1060 + 21 * (t - 50);
    if (t <= 200) return 1920 + 23 * (t - 100);
    return 3820 + 27 * (t - 200);
}

function calcFuelCost(aircraftType, distanceKm) {
    const ac = getAircraftData(aircraftType);
    const kgPerKm = ac.cruiseFuelBurn * FUEL_DENSITY;
    const yuanPerKm = kgPerKm / 1000 * FUEL_PRICE_PER_TON;
    return yuanPerKm * distanceKm;
}

function calcSegmentCost(aircraftType, distanceKm) {
    const enroute = calcEnrouteFee(aircraftType, distanceKm);
    const landing = calcLandingFee(aircraftType) * 2;
    const fuel = calcFuelCost(aircraftType, distanceKm);

    return {
        enroute: enroute,
        landing: landing,
        fuel: fuel,
        total: enroute + landing + fuel
    };
}

// ==================== 航线开通费算法 ====================

const ROUTE_OPEN_FEE_PER_KM = 8500;

function calcRouteOpenFee(distanceKm) {
    return Math.round(distanceKm * ROUTE_OPEN_FEE_PER_KM);
}

// ==================== 客座率算法 ====================

const LOAD_FACTOR_CONSTANTS = {
    BASE: 0.6,
    WAKECAT: { "M": 1.0, "H": 1.2, "J": 1.3 },
    DIST_DECAY: 800,
    CAP: 0.95
};

/**
 * 用于整体大客座率展示（或者未分舱时兜底）。
 * 注意：分舱结算时，应该直接用实际需求去卡座位，不再用这个去乘座位数。
 */
function calcLoadFactor(fromIata, toIata, aircraftType, outboundCapacity) {
    const ac = getAircraftData(aircraftType);
    const dur = calcFlightDuration(fromIata, toIata, aircraftType);
    if (!dur) return 0;

    const catFactor = LOAD_FACTOR_CONSTANTS.WAKECAT[ac.wakeCategory] || 1.0;
    const repFactor = 0.5 + airlineReputation / 100;
    const distFactor = 1 - Math.exp(-dur.distance / LOAD_FACTOR_CONSTANTS.DIST_DECAY);

    let lf = LOAD_FACTOR_CONSTANTS.BASE * catFactor * repFactor * distFactor;

    if (outboundCapacity && outboundCapacity > 0) {
        const demand = calcRouteDemandShared(fromIata, toIata);
        if (demand && demand.total > 0) {
            const demandRatio = demand.total / outboundCapacity;
            lf = Math.min(lf, demandRatio);
        }
    }

    return Math.min(lf, LOAD_FACTOR_CONSTANTS.CAP);
}

// ==================== 启动页背景航线 ====================

const DEMO_ROUTES = [
    [0, 1],
    [2, 3],
    [6, 5],
    [7, 8]
];
