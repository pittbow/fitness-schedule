const DAY_ORDER = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
const WEEKDAY_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const FAVORITES_KEY = 'ff_favorites';

let flatClasses = [];
let areaOptions = [];
let storeOptions = [];
let favorites = new Set(loadFavorites());

const searchInput = document.getElementById('searchInput');
const areaFilter = document.getElementById('areaFilter');
const storeFilter = document.getElementById('storeFilter');
const dayFilter = document.getElementById('dayFilter');
const favoritesOnlyEl = document.getElementById('favoritesOnly');
const favoritesCountEl = document.getElementById('favoritesCount');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const dataInfoEl = document.getElementById('dataInfo');

function loadFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favorites)));
}

function classKey(item) {
  return `${item.storeUrl}|${item.week}|${item.time}|${item.name}`;
}

function toggleFavorite(key) {
  if (favorites.has(key)) favorites.delete(key);
  else favorites.add(key);
  saveFavorites();
  render();
}

function todayWeekName() {
  return WEEKDAY_NAMES[new Date().getDay()];
}

function normalize(s) {
  return (s || '').toString().trim().toLowerCase();
}

async function loadData() {
  statusEl.textContent = '載入課表資料中...';
  const res = await fetch('data/schedule.json');
  const data = await res.json();

  const areaSet = new Map();
  flatClasses = [];
  storeOptions = [];

  data.stores.forEach(store => {
    if (!areaSet.has(store.areaId)) areaSet.set(store.areaId, store.areaName);
    storeOptions.push({ url: store.url, name: store.name, areaId: store.areaId, areaName: store.areaName });
    (store.classes || []).forEach(c => {
      flatClasses.push({
        storeName: store.name,
        storeUrl: store.url,
        areaId: store.areaId,
        areaName: store.areaName,
        week: c.week,
        date: c.date,
        time: c.time,
        name: c.name,
        room: c.room,
        teacher: c.teacher
      });
    });
  });

  areaOptions = Array.from(areaSet.entries()).map(([id, name]) => ({ id, name }));
  areaOptions.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  areaOptions.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name;
    areaFilter.appendChild(opt);
  });

  buildStoreOptions();

  dataInfoEl.textContent = `課表週期：${data.weekLabel}　資料更新：${new Date(data.generatedAt).toLocaleString('zh-TW')}`;
  statusEl.textContent = '';
  render();
}

function buildStoreOptions() {
  const areaId = areaFilter.value;
  const prevValue = storeFilter.value;

  storeFilter.innerHTML = '<option value="">所有分廠</option>';

  const relevant = areaId ? storeOptions.filter(s => s.areaId === areaId) : storeOptions;

  if (areaId) {
    relevant
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
      .forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.url;
        opt.textContent = s.name;
        storeFilter.appendChild(opt);
      });
  } else {
    const byArea = new Map();
    relevant.forEach(s => {
      if (!byArea.has(s.areaId)) byArea.set(s.areaId, { areaName: s.areaName, stores: [] });
      byArea.get(s.areaId).stores.push(s);
    });
    const groups = Array.from(byArea.values());
    groups.sort((a, b) => a.areaName.localeCompare(b.areaName, 'zh-Hant'));
    groups.forEach(g => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = g.areaName;
      g.stores
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
        .forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.url;
          opt.textContent = s.name;
          optgroup.appendChild(opt);
        });
      storeFilter.appendChild(optgroup);
    });
  }

  if (relevant.some(s => s.url === prevValue)) {
    storeFilter.value = prevValue;
  }
}

function matches(item, query) {
  if (!query) return true;
  return normalize(item.storeName).includes(query) ||
         normalize(item.name).includes(query) ||
         normalize(item.teacher).includes(query);
}

function render() {
  const query = normalize(searchInput.value);
  const area = areaFilter.value;
  const store = storeFilter.value;
  const day = dayFilter.value;
  const favoritesOnly = favoritesOnlyEl.checked;
  const today = todayWeekName();

  favoritesCountEl.textContent = favorites.size ? `（${favorites.size}）` : '';

  if (!query && !area && !store && !day && !favoritesOnly) {
    resultsEl.innerHTML = '';
    statusEl.textContent = '';
    const hint = document.createElement('div');
    hint.className = 'hint-state';
    hint.textContent = '輸入分廠、課程或老師姓名開始搜尋，或用上面的下拉選單挑分廠';
    resultsEl.appendChild(hint);
    return;
  }

  const filtered = flatClasses.filter(item => {
    if (area && item.areaId !== area) return false;
    if (store && item.storeUrl !== store) return false;
    if (day && item.week !== day) return false;
    if (favoritesOnly && !favorites.has(classKey(item))) return false;
    return matches(item, query);
  });

  if (filtered.length === 0) {
    resultsEl.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = favoritesOnly && favorites.size === 0
      ? '你還沒有收藏任何課程，點課程旁邊的星星加入收藏'
      : '找不到符合的課程，換個關鍵字試試看';
    resultsEl.appendChild(empty);
    statusEl.textContent = '';
    return;
  }

  statusEl.textContent = `找到 ${filtered.length} 堂課`;

  const byStore = new Map();
  filtered.forEach(item => {
    const key = item.storeUrl;
    if (!byStore.has(key)) byStore.set(key, { storeName: item.storeName, areaName: item.areaName, items: [] });
    byStore.get(key).items.push(item);
  });

  const groups = Array.from(byStore.values());
  groups.sort((a, b) => a.storeName.localeCompare(b.storeName, 'zh-Hant'));
  groups.forEach(g => {
    g.items.sort((a, b) => {
      const dOrder = DAY_ORDER.indexOf(a.week) - DAY_ORDER.indexOf(b.week);
      if (dOrder !== 0) return dOrder;
      return a.time.localeCompare(b.time);
    });
  });

  resultsEl.innerHTML = '';
  groups.forEach(g => {
    const card = document.createElement('div');
    card.className = 'store-group';

    const h2 = document.createElement('h2');
    h2.textContent = g.storeName;
    const areaTag = document.createElement('span');
    areaTag.className = 'area-tag';
    areaTag.textContent = g.areaName;
    h2.appendChild(areaTag);
    card.appendChild(h2);

    g.items.forEach(item => {
      const isToday = item.week === today;
      const key = classKey(item);
      const isFavorite = favorites.has(key);

      const row = document.createElement('div');
      row.className = 'class-row' + (isToday ? ' today' : '');

      const dayEl = document.createElement('div');
      dayEl.className = 'class-day';
      dayEl.textContent = item.week;
      const timeEl = document.createElement('span');
      timeEl.className = 'time';
      timeEl.textContent = item.time;
      dayEl.appendChild(timeEl);
      if (isToday) {
        const badge = document.createElement('span');
        badge.className = 'today-badge';
        badge.textContent = '今天';
        dayEl.appendChild(document.createElement('br'));
        dayEl.appendChild(badge);
      }

      const mainEl = document.createElement('div');
      mainEl.className = 'class-main';
      const nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = item.name;
      const roomEl = document.createElement('div');
      roomEl.className = 'room';
      roomEl.textContent = item.room;
      mainEl.appendChild(nameEl);
      mainEl.appendChild(roomEl);

      const teacherEl = document.createElement('div');
      teacherEl.className = 'class-teacher';
      teacherEl.textContent = item.teacher;

      const starBtn = document.createElement('button');
      starBtn.type = 'button';
      starBtn.className = 'star-button' + (isFavorite ? ' active' : '');
      starBtn.textContent = isFavorite ? '★' : '☆';
      starBtn.setAttribute('aria-label', isFavorite ? '取消收藏' : '加入收藏');
      starBtn.addEventListener('click', () => toggleFavorite(key));

      row.appendChild(dayEl);
      row.appendChild(mainEl);
      row.appendChild(teacherEl);
      row.appendChild(starBtn);
      card.appendChild(row);
    });

    resultsEl.appendChild(card);
  });
}

let debounceTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(render, 120);
});
areaFilter.addEventListener('change', () => {
  buildStoreOptions();
  render();
});
storeFilter.addEventListener('change', render);
dayFilter.addEventListener('change', render);
favoritesOnlyEl.addEventListener('change', render);

loadData().catch(err => {
  statusEl.textContent = '課表資料載入失敗：' + err.message;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
