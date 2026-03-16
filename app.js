/* ===== Constants ===== */
const DATA_URL = 'data/exhibitions.json';
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const DISPLAY_COUNT = 20;

/* ===== State ===== */
let allExhibitions = [];
let displayData = [];
let selectedPlaces = new Set();
let currentPage = 1;

/* ===== Utility Functions ===== */
function getNaverMapLink(site) {
  return `https://map.naver.com/v5/search/${encodeURIComponent(site)}`;
}

function sanitizeHTML(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatToDot(dateStr) {
  if (!dateStr) return '';
  const digits = dateStr.replace(/\D/g, '');
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
  }
  return dateStr.replace(/-/g, '.');
}

/**
 * YYYYMMDD 문자열을 Date 객체로 변환
 * [FIX] 기존에는 정규식 replace 후 new Date()를 호출했는데,
 *       로컬 타임존 이슈로 하루 차이가 발생할 수 있음 → 로컬 기반으로 통일
 */
function parseYMD(ymd) {
  const y = parseInt(ymd.slice(0, 4), 10);
  const m = parseInt(ymd.slice(4, 6), 10) - 1;
  const d = parseInt(ymd.slice(6, 8), 10);
  return new Date(y, m, d);
}

/**
 * D-day 계산 (일 단위)
 * [FIX] 시간 소수점 문제 방지를 위해 날짜만 비교
 */
function calcDday(targetYMD) {
  const target = parseYMD(targetYMD);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((target - today) / 86400000);
}

/* ===== Date Input Handling ===== */
const vText = document.getElementById('visitDateText');
const vPicker = document.getElementById('visitDatePicker');

vText.addEventListener('input', (e) => {
  let val = e.target.value.replace(/\D/g, '');
  if (val.length > 8) val = val.slice(0, 8);
  let formatted = val;
  if (val.length > 4) formatted = val.slice(0, 4) + '.' + val.slice(4);
  if (val.length > 6) formatted = formatted.slice(0, 7) + '.' + formatted.slice(7);
  e.target.value = formatted;
  if (val.length === 8) {
    vPicker.value = `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}`;
  }
});

vPicker.addEventListener('change', (e) => {
  vText.value = e.target.value.replace(/-/g, '.');
});

function setToday() {
  vText.value = formatToDot(TODAY);
  vPicker.value = `${TODAY.slice(0, 4)}-${TODAY.slice(4, 6)}-${TODAY.slice(6, 8)}`;
  applyVisitFilter();
}

/* ===== Place Filter ===== */
function filterPlaceList() {
  const query = document.getElementById('placeSearch').value.toLowerCase();
  document.querySelectorAll('.place-item').forEach(item => {
    item.style.display = item.textContent.toLowerCase().includes(query) ? 'flex' : 'none';
  });
}

function generatePlaceList() {
  const container = document.getElementById('placeList');
  const sites = [...new Set(allExhibitions.map(item => item.site))].sort();
  container.innerHTML = sites.map((site, i) => `
    <div class="place-item" style="cursor:pointer;" onclick="togglePlaceByIdx(${i})">
      <input type="checkbox" data-site-idx="${i}" onclick="event.stopPropagation();togglePlaceByIdx(${i})">
      <span>${sanitizeHTML(site)}</span>
    </div>
  `).join('');
  container._sites = sites;
}

function togglePlaceByIdx(i) {
  const container = document.getElementById('placeList');
  const site = container._sites[i];
  const cb = container.querySelector(`input[data-site-idx="${i}"]`);
  if (selectedPlaces.has(site)) {
    selectedPlaces.delete(site);
    cb.checked = false;
  } else {
    selectedPlaces.add(site);
    cb.checked = true;
  }
  filterData();
}

function resetPlaces() {
  selectedPlaces.clear();
  document.querySelectorAll('#placeList input[type=checkbox]').forEach(cb => cb.checked = false);
  filterData();
}

function resetAll() {
  document.getElementById('keywordSearch').value = '';
  vText.value = '';
  vPicker.value = '';
  resetPlaces();
}

/* ===== Filter & Sort ===== */
function applyVisitFilter() {
  filterData();
}

function filterData() {
  const visitDate = vText.value.replace(/\./g, '');
  const keyword = document.getElementById('keywordSearch').value.toLowerCase().trim();

  displayData = allExhibitions.filter(item => {
    const isPlaceMatch = selectedPlaces.size === 0 || selectedPlaces.has(item.site);
    const isDateMatch = !visitDate || (item.startDate <= visitDate && item.endDate >= visitDate);
    const isKeywordMatch = !keyword || [item.title, item.site, item.description].some(
      f => f?.toLowerCase().includes(keyword)
    );
    return isPlaceMatch && isDateMatch && isKeywordMatch;
  });

  /**
   * [FIX] keyword가 빈 문자열일 때 sort 건너뛰기
   * 빈 문자열이면 includes('')가 항상 true → 의미 없는 정렬이 됨
   */
  if (keyword) {
    displayData.sort((a, b) => {
      const score = (item) => {
        if (item.title?.toLowerCase().includes(keyword)) return 0;
        if (item.description?.toLowerCase().includes(keyword)) return 1;
        if (item.site?.toLowerCase().includes(keyword)) return 2;
        return 3;
      };
      return score(a) - score(b);
    });
  }

  renderPage(1);
}

/* ===== Render ===== */
function renderPage(page) {
  const totalPages = Math.ceil(displayData.length / DISPLAY_COUNT);

  /**
   * [FIX] 필터 결과가 줄어들어 현재 페이지가 범위를 초과하면 마지막 페이지로 이동
   */
  if (page > totalPages && totalPages > 0) {
    page = totalPages;
  }

  currentPage = page;
  const grid = document.getElementById('cardGrid');
  const start = (page - 1) * DISPLAY_COUNT;
  const pageData = displayData.slice(start, start + DISPLAY_COUNT);

  grid.innerHTML = pageData.map((item, idx) => {
    const globalIdx = start + idx;
    let tagText = item.status;

    if (item.statusClass === 'tag-ongoing') {
      const dday = calcDday(item.endDate);
      tagText = `전시 중 / D-${dday}`;
    } else if (item.statusClass === 'tag-upcoming') {
      const daysUntil = calcDday(item.startDate);
      tagText = `전시 예정 / ${daysUntil}일 후 시작`;
    }

    return `
      <div class="card">
        <img src="${item.img}" class="card-img"
             onclick="openModalByIdx(${globalIdx})"
             onerror="this.onerror=null;this.outerHTML='<div class=\\'card-img-placeholder\\' onclick=\\'openModalByIdx(${globalIdx})\\'>No Image</div>';">
        <div class="card-body">
          <span class="card-tag ${item.statusClass}">${tagText}</span>
          <div class="card-title" onclick="openModalByIdx(${globalIdx})">${sanitizeHTML(item.title)}</div>
          <div class="card-info"><span class="gray-icon">📅</span> ${item.period}</div>
          <div class="card-info"><span>📍</span> <a href="${getNaverMapLink(item.site)}" target="_blank" class="map-link">${sanitizeHTML(item.site)}</a></div>
        </div>
      </div>
    `;
  }).join('');

  updatePagination();
}

/* ===== Modal ===== */
function openModalByIdx(idx) {
  const item = displayData[idx];
  if (!item) return; // [FIX] 인덱스 초과 방어

  document.getElementById('modalTitle').innerText = item.title;
  document.getElementById('modalImg').src = item.img || '';
  document.getElementById('modalImg').style.display = item.img ? 'block' : 'none'; // [FIX] 이미지 없으면 숨기기
  document.getElementById('modalPeriod').innerHTML = `<span class="gray-icon">📅</span> ${item.period}`;
  document.getElementById('modalSite').innerHTML = `<a href="${getNaverMapLink(item.site)}" target="_blank" class="map-link">${item.site}</a>`;
  document.getElementById('modalCharge').innerText = item.charge || '정보 없음';
  document.getElementById('modalDesc').innerHTML = item.description || '내용 없음';
  document.getElementById('modalUrl').href = item.url || '#';
  document.getElementById('modalOverlay').style.display = 'flex';
  setTimeout(() => document.getElementById('modalContent').scrollTop = 0, 0);
}

function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
}

/* ===== Pagination ===== */
function updatePagination() {
  const container = document.getElementById('pagination');
  const totalPages = Math.ceil(displayData.length / DISPLAY_COUNT);
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const makeBtn = (p) =>
    `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="renderPage(${p})">${p}</button>`;
  const makeDot = () => `<span style="color:var(--text-muted);padding:0 4px">…</span>`;

  let html = '';

  // ◀ 이전 페이지
  html += `<button class="page-btn" onclick="renderPage(${Math.max(1, currentPage - 1)})" ${currentPage === 1 ? 'disabled style="opacity:0.3;cursor:default"' : ''}>◀</button>`;

  if (totalPages <= 5) {
    // [FIX] 총 페이지가 5 이하면 전부 표시
    for (let p = 1; p <= totalPages; p++) {
      html += makeBtn(p);
    }
  } else if (currentPage <= 3) {
    [1, 2, 3].forEach(p => { if (p <= totalPages) html += makeBtn(p); });
    if (totalPages > 4) html += makeDot();
    if (totalPages > 3) html += makeBtn(totalPages);
  } else if (currentPage >= totalPages - 2) {
    // [FIX] 마지막 근처 페이지: 1,...,last-2,last-1,last
    html += makeBtn(1);
    html += makeDot();
    for (let p = totalPages - 2; p <= totalPages; p++) {
      html += makeBtn(p);
    }
  } else {
    // 중간: 1,2,3,...,current,...,last
    [1, 2, 3].forEach(p => html += makeBtn(p));
    html += makeDot();
    html += makeBtn(currentPage);
    if (currentPage < totalPages - 1) {
      html += makeDot();
    }
    html += makeBtn(totalPages);
  }

  // ▶ 다음 페이지
  html += `<button class="page-btn" onclick="renderPage(${Math.min(totalPages, currentPage + 1)})" ${currentPage === totalPages ? 'disabled style="opacity:0.3;cursor:default"' : ''}>▶</button>`;

  container.innerHTML = html;
}

/* ===== Keyboard Navigation ===== */
document.addEventListener('keydown', (e) => {
  // ESC로 모달 닫기
  if (e.key === 'Escape') {
    closeModal();
  }
});

/* ===== Data Loading ===== */
async function loadData() {
  const loadStatus = document.getElementById('loadInfo');
  try {
    loadStatus.innerText = '데이터 로드 중...';
    const res = await fetch(DATA_URL + '?t=' + Date.now(), {
    cache: 'no-store'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if (!json.items || json.items.length === 0) {
      loadStatus.innerText = '데이터 준비 중 — GitHub Actions가 오늘 밤 처음 실행됩니다';
      return;
    }

    // 오늘 날짜 기준으로 종료된 전시 재필터 (JSON은 갱신 시점 기준이므로)
    allExhibitions = json.items.filter(item => item.endDate >= TODAY);
    displayData = allExhibitions;
    generatePlaceList();
    renderPage(1);

    const updatedAt = json.updatedAt
      ? new Date(json.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
      : '알 수 없음';
    loadStatus.innerText = `총 ${allExhibitions.length}건 | 마지막 갱신: ${updatedAt}`;
  } catch (e) {
    console.error('loadData 실패:', e);
    loadStatus.innerText = `데이터 로드 실패: ${e.message}`;
  }
}

loadData();
