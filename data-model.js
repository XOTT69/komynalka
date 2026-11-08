/* Shared write contract. Reading old accounts never rewrites or drops their fields. */
(function (global) {
  'use strict';
  const MAX_SYNC_BYTES = 512 * 1024;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
  const nonnegative = value => number(value) && Number(value) >= 0;
  const id = value => typeof value === 'string' && value.length > 0 && value.length <= 200 || typeof value === 'number' && Number.isFinite(value);
  const month = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const readingFields = ['wPrev', 'wCur', 'hwPrev', 'hwCur', 'dPrev', 'dCur', 'nPrev', 'nCur', 'gPrev', 'gCur'];
  const amountFields = ['total', 'waterCost', 'hotWaterCost', 'electroCost', 'gasCost', 'customCost', 'paidAmount'];
  function fail(code) { throw new Error(code); }
  function field(value, previous, valid, code) {
    // Unchanged legacy values stay recoverable; they are rendered as text.
    if (!valid(value) && !same(value, previous)) fail(code);
  }
  function counts(records) {
    const result = new Map();
    for (const record of records || []) result.set(record.month, (result.get(record.month) || 0) + 1);
    return result;
  }
  function validateSnapshot(snapshot, previous = {}) {
    if (!object(snapshot) || !Array.isArray(snapshot.addresses) || snapshot.addresses.length < 1 || snapshot.addresses.length > 10) fail('INVALID_DATA');
    const addressIds = new Set();
    for (const address of snapshot.addresses) {
      if (!object(address) || !id(address.id) || !Array.isArray(address.records)) fail('INVALID_ADDRESS');
      if (addressIds.has(String(address.id))) fail('DUPLICATE_ID');
      addressIds.add(String(address.id));
      const old = previous.addresses?.find(item => String(item.id) === String(address.id));
      if (address.name !== undefined) field(address.name, old?.name, value => typeof value === 'string', 'INVALID_ADDRESS');
      for (const key of ['tariffs', 'prefs']) if (address[key] !== undefined) field(address[key], old?.[key], object, 'INVALID_ADDRESS');
      const oldRecords=new Map((old?.records||[]).map(item=>[String(item.id),item]));
      const oldMonths = counts(old?.records), newMonths = counts(address.records), recordIds = new Set();
      for (const [period, count] of newMonths) if (count > 1 && count > (oldMonths.get(period) || 0)) fail('DUPLICATE_MONTH');
      for (const record of address.records) {
        if (!object(record) || !id(record.id) || !month(record.month)) fail('INVALID_RECORD');
        if (recordIds.has(String(record.id))) fail('DUPLICATE_ID');
        recordIds.add(String(record.id));
        const before = oldRecords.get(String(record.id));
        if(record.total===null)field(record.total,before?.total,nonnegative,'INVALID_AMOUNT');
        if(record.paymentDate!==undefined&&record.paymentDate!=='')field(record.paymentDate,before?.paymentDate,value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value,'INVALID_PAYMENT_DATE');
        for (const key of [...readingFields, ...amountFields]) if (record[key] !== undefined && record[key] !== null) field(record[key], before?.[key], nonnegative, readingFields.includes(key) ? 'INVALID_READING' : 'INVALID_AMOUNT');
        for (const key of ['note', 'paymentReference']) if (record[key] !== undefined) field(record[key], before?.[key], value => typeof value === 'string', 'INVALID_RECORD');
        if (record.customData !== undefined) {
          field(record.customData, before?.customData, object, 'INVALID_SERVICE');
          if (object(record.customData)) for (const [key, item] of Object.entries(record.customData)) {
            if (!object(item)) { if (!same(item, before?.customData?.[key])) fail('INVALID_SERVICE'); continue; }
            field(item.val, before?.customData?.[key]?.val, nonnegative, 'INVALID_AMOUNT');
            if (item.name !== undefined) field(item.name, before?.customData?.[key]?.name, value => typeof value === 'string', 'INVALID_SERVICE');
          }
        }
      }
      if (address.customServices !== undefined) {
        if (!Array.isArray(address.customServices)) fail('INVALID_SERVICE');
        const services = new Set();
        for (const service of address.customServices) {
          if (!object(service) || !id(service.id) || services.has(String(service.id))) fail('INVALID_SERVICE');
          services.add(String(service.id));
          const before = old?.customServices?.find(item => String(item.id) === String(service.id));
          if (service.defaultSum !== undefined && service.defaultSum !== '') field(service.defaultSum, before?.defaultSum, nonnegative, 'INVALID_AMOUNT');
        }
      }
    }
    if (snapshot.accountSettings !== undefined) field(snapshot.accountSettings, previous.accountSettings, object, 'INVALID_SETTINGS');
    return snapshot;
  }
  function payloadBytes(snapshot) {
    // Include the largest normal synchronization envelope, not just the import file.
    const payload = {...snapshot, baseRevision: Number.MAX_SAFE_INTEGER, clientMutationId: 'x'.repeat(128)};
    return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  }
  function checkSize(snapshot) { if (payloadBytes(snapshot) > MAX_SYNC_BYTES) fail('PAYLOAD_TOO_LARGE'); }
  function entered(record, current, service) {
    if (!record || record._filled?.[service] === false) return false;
    if (typeof record._enteredCurrent?.[current] === 'boolean') return record._enteredCurrent[current];
    return record[current] !== null && record[current] !== undefined && record[current] !== '' && nonnegative(record[current]);
  }
  function electricity(day, night, tariffs, winter) {
    const total = day + night;
    if (!total) return 0;
    if (!winter) return day * tariffs.electroBase + night * tariffs.electroBase * tariffs.nightCoef;
    const discounted = Math.min(total, tariffs.winterLimit), base = total - discounted;
    return (day + night * tariffs.nightCoef) / total * (discounted * tariffs.electroWinter + base * tariffs.electroBase);
  }
  function forecast(records, period) {
    if(!month(period))return null;
    const history=(records||[]).filter(item=>month(item.month)&&item.month<period&&nonnegative(item.total)).sort((a,b)=>a.month.localeCompare(b.month));
    if(history.length<3||new Set(history.map(item=>item.month)).size!==history.length)return null;
    const ordinal=value=>{const [year,part]=value.split('-').map(Number);return year*12+part-1;};
    const origin=ordinal(history[0].month),x=history.map(item=>ordinal(item.month)-origin),y=history.map(item=>Number(item.total)),n=x.length;
    const sx=x.reduce((a,b)=>a+b,0),sy=y.reduce((a,b)=>a+b,0),sxy=x.reduce((sum,value,i)=>sum+value*y[i],0),sxx=x.reduce((sum,value)=>sum+value*value,0);
    const divisor=n*sxx-sx*sx;if(!divisor)return null;
    const slope=(n*sxy-sx*sy)/divisor,intercept=(sy-slope*sx)/n;
    return {predicted:Math.round(Math.max(0,intercept+slope*(ordinal(period)-origin))*100)/100,trend:Math.round(slope*100)/100,confidence:'estimate',sampleMonths:n,spanMonths:x[n-1]+1};
  }
  const messages = {
    DUPLICATE_MONTH: 'Є кілька записів за один місяць. Порівняйте їх перед об’єднанням; жоден запис не видалено.',
    DUPLICATE_ID: 'Повторюються ідентифікатори записів або адрес. Оригінал збережено.',
    INVALID_READING: 'Показники мають бути невід’ємними числами. Оригінальні дані збережено.',
    INVALID_PAYMENT_DATE: 'Вкажіть правильну календарну дату оплати.',
    INVALID_AMOUNT: 'Суми мають бути невід’ємними числами. Перевірте додаткові послуги.',
    INVALID_SERVICE: 'Перевірте назви, суми та ідентифікатори додаткових послуг.',
    PAYLOAD_TOO_LARGE: 'Обсяг даних перевищує ліміт синхронізації 512 КіБ. Збережіть JSON-копію; дані залишаються на пристрої.',
    INVALID_DATA: 'Перевірте формат даних і кількість адрес.',
  };
  global.KomunalkaModel = Object.freeze({validateSnapshot, checkSize, payloadBytes, MAX_SYNC_BYTES, entered, electricity, forecast, number, nonnegative, message: code => messages[code] || 'Перевірте формат даних. Оригінал збережено.'});
})(typeof window !== 'undefined' ? window : globalThis);
