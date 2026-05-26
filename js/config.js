export const WORKER_URL = "https://komunproga.mikolenko-anton1.workers.dev";
export const APP_VERSION = '4.0.0';
export const MAX_ADDRESSES = 3;

export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBgRHmaHjg23BIZjJdCucwnmMFDX57XP80",
    authDomain: "pwakomun.firebaseapp.com",
    projectId: "pwakomun",
    storageBucket: "pwakomun.firebasestorage.app",
    messagingSenderId: "4437974770",
    appId: "1:4437974770:web:bf7d2f7bac35eff5707a6b"
};

export const DEFAULT_TARIFFS = {
    water: 30.38, hotWater: 100.00,
    electroBase: 4.32, electroWinter: 2.64,
    winterLimit: 2000, nightCoef: 0.5,
    gas: 7.96, heating: 1654.76, drainage: 19.02
};

export const DEFAULT_PREFS = {
    showWater: true, showHotWater: false,
    showElectro: true, showGas: true,
    showHeating: false, showDrainage: false,
    electroTwoZone: true, electroWinter: true,
    remindersEnabled: false,
    remWaterStart: 1, remWaterEnd: 5,
    remElectroStart: 28, remElectroEnd: 3
};

export const DEFAULT_SERVICES = [
    { id: "s1", name: "Квартплата", defaultSum: "" },
    { id: "s2", name: "Сміття", defaultSum: "" }
];
