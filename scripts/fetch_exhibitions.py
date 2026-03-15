import os
import json
import urllib.request
import urllib.parse
import time
from datetime import datetime, timezone, timedelta
from xml.etree import ElementTree as ET

SERVICE_KEY = os.environ['SERVICE_KEY']
API_URL = 'https://api.kcisa.kr/openapi/CNV_060/request'
FETCH_COUNT = 500
MIN_VALID_COUNT = 100   # 이 건수 미만이면 저장 중단 (비정상 응답 방어)
MAX_RETRIES = 3         # 페이지당 최대 재시도 횟수
RETRY_DELAY = 5         # 재시도 대기 시간 (초)
KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST).strftime('%Y%m%d')


def get_val(item, tag):
    node = item.find(tag)
    return node.text.strip() if node is not None and node.text else ''


def format_to_dot(date_str):
    digits = ''.join(c for c in date_str if c.isdigit())
    if len(digits) == 8:
        return f'{digits[:4]}.{digits[4:6]}.{digits[6:8]}'
    return date_str


def parse_items(root):
    items = []
    for item in root.iter('item'):
        raw_period = get_val(item, 'eventPeriod')
        parts = raw_period.split('~')
        period = ' ~ '.join(format_to_dot(p.strip()) for p in parts)
        start = ''.join(c for c in parts[0].strip() if c.isdigit()) if parts else '0'
        end = ''.join(c for c in parts[1].strip() if c.isdigit()) if len(parts) > 1 else '99991231'
        status = '전시 중' if start <= TODAY <= end else '전시 예정'
        items.append({
            'title': get_val(item, 'title'),
            'period': period,
            'startDate': start,
            'endDate': end,
            'status': status,
            'statusClass': 'tag-ongoing' if status == '전시 중' else 'tag-upcoming',
            'site': get_val(item, 'eventSite') or '장소 미정',
            'img': get_val(item, 'imageObject'),
            'charge': get_val(item, 'charge'),
            'url': get_val(item, 'url'),
            'description': get_val(item, 'description')
        })
    return items


def fetch_page(page_no):
    """페이지 호출 — 실패 시 최대 MAX_RETRIES회 재시도"""
    params = urllib.parse.urlencode({
        'serviceKey': SERVICE_KEY,
        'pageNo': page_no,
        'numOfRows': FETCH_COUNT,
        'dtype': '전시'
    })
    url = f'{API_URL}?{params}'

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return response.read().decode('utf-8')
        except Exception as e:
            if attempt == MAX_RETRIES:
                raise RuntimeError(f'페이지 {page_no} 호출 최종 실패 ({MAX_RETRIES}회 시도): {e}')
            print(f'  [재시도 {attempt}/{MAX_RETRIES}] 페이지 {page_no} 호출 실패: {e} — {RETRY_DELAY}초 후 재시도')
            time.sleep(RETRY_DELAY)


def main():
    print(f'[{datetime.now(KST).isoformat()}] 데이터 수집 시작 (기준일: {TODAY})')

    text = fetch_page(1)
    root = ET.fromstring(text)

    result_code = root.findtext('.//resultCode') or root.findtext('.//errCode')
    if result_code and result_code not in ('0000', '00'):
        err_msg = root.findtext('.//resultMsg') or root.findtext('.//errMsg') or '알 수 없는 오류'
        raise RuntimeError(f'API 오류 [{result_code}]: {err_msg}')

    total_count_node = root.find('.//totalCount')
    total_count = int(total_count_node.text) if total_count_node is not None else 0
    items = parse_items(root)
    print(f'  1페이지 수집: {len(items)}건 (전체 {total_count}건)')

    if total_count > FETCH_COUNT:
        total_pages = -(-total_count // FETCH_COUNT)
        for page in range(2, total_pages + 1):
            text = fetch_page(page)
            root = ET.fromstring(text)
            new_items = parse_items(root)
            items.extend(new_items)
            print(f'  {page}/{total_pages}페이지 수집: {len(new_items)}건 (누적 {len(items)}건)')

    before_filter = len(items)
    items = [item for item in items if item['endDate'] >= TODAY]
    print(f'  필터링: {before_filter}건 → {len(items)}건 (종료 {before_filter - len(items)}건 제외)')

    # 최소 수집 건수 검증 — 비정상 응답으로 기존 데이터 덮어쓰기 방지
    if len(items) < MIN_VALID_COUNT:
        raise RuntimeError(
            f'수집 건수({len(items)}건)가 최솟값({MIN_VALID_COUNT}건) 미만 — '
            f'API 응답 이상으로 판단하여 저장 중단'
        )

    os.makedirs('data', exist_ok=True)
    output = {
        'updatedAt': datetime.now(KST).isoformat(),
        'today': TODAY,
        'totalCount': len(items),
        'items': items
    }
    with open('data/exhibitions.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f'  저장 완료: data/exhibitions.json ({len(items)}건)')


if __name__ == '__main__':
    main()
