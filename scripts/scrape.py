"""Refresh data/schedule.json from the Fitness Factory (健身工廠) public schedule tool.

Run manually:
    python scripts/scrape.py

Intended to also be run unattended (e.g. Windows Task Scheduler).
Only reads the public, unauthenticated schedule-lookup endpoints already used by
https://www.fitnessfactory.com.tw/tw/course?page=schedule - no login, no write actions.
"""
import re
import io
import sys
import json
import time
import random
import datetime
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

BASE = 'https://www.fitnessfactory.com.tw'
ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / 'data' / 'schedule.json'
LOG_PATH = ROOT / 'logs' / 'scrape.log'
REQUEST_DELAY_SEC = 0.4
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
}

AREA_RE = re.compile(
    r"<li class=\"bkLocationArea\"\s+data-id='(\d+)'>\s*([^<]+?)\s*</li>"
)
STORE_RE = re.compile(
    r"<li class=\"bkLocationStore\"\s+data-f='(\d+)'\s+data-id='(\d+)'\s+data-url='([^']+)'>\s*([^<]+?)\s*</li>"
)
DATE_TH_RE = re.compile(
    r'<div class="th">.*?<div class="date">(\d+)</div>.*?<div class="week">([^<]+)</div>',
    re.S,
)
NAME_RE = re.compile(r'<div class="name">([^<]*)</div>')
TIME_RE = re.compile(r'<div class="time">([^<]*)</div>')
ROOM_RE = re.compile(r'<div class="classroom">([^<]*)</div>')
TEACHER_RE = re.compile(r'<div class="teacher">\s*<span>([^<]*)</span>')


def log(msg):
    line = f'[{datetime.datetime.now().isoformat(timespec="seconds")}] {msg}'
    print(line)
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_PATH, 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode('utf-8')


def get_areas_and_stores():
    html = fetch(f'{BASE}/tw/course?page=schedule')
    areas = [{'id': m.group(1), 'name': m.group(2).strip()} for m in AREA_RE.finditer(html)]
    stores = [
        {'areaId': m.group(1), 'storeNumId': m.group(2), 'url': m.group(3), 'name': m.group(4).strip()}
        for m in STORE_RE.finditer(html)
    ]
    return areas, stores


def parse_schedule(schedule_html, date_html):
    days = [{'date': m.group(1), 'week': m.group(2)} for m in DATE_TH_RE.finditer(date_html)]
    entries = []
    trs = schedule_html.split('<div class="tr">')[1:]
    for tr in trs:
        tds = tr.split('<div class="td">')[1:]
        for col_idx, td in enumerate(tds):
            if col_idx >= len(days):
                break
            boxes = td.split('<div class="course-box"')[1:]
            for box in boxes:
                name_m = NAME_RE.search(box)
                if not name_m or not name_m.group(1).strip():
                    continue
                time_m = TIME_RE.search(box)
                room_m = ROOM_RE.search(box)
                teacher_m = TEACHER_RE.search(box)
                entries.append({
                    'week': days[col_idx]['week'],
                    'date': days[col_idx]['date'],
                    'time': time_m.group(1).strip() if time_m else '',
                    'name': name_m.group(1).strip(),
                    'room': room_m.group(1).strip() if room_m else '',
                    'teacher': teacher_m.group(1).strip() if teacher_m else '',
                })
    return entries


def get_store_schedule(store_url, date_str):
    params = urllib.parse.urlencode({
        'page': 'schedule', 'store': store_url,
        'cate': 0, 'class': 0, 'teacher': 0, 'room': 0,
        'date': date_str,
    })
    raw = fetch(f'{BASE}/tw/course/ajax/filterSchedule?{params}')
    data = json.loads(raw)
    return parse_schedule(data['scheduleView'], data['dateView'])


def load_existing():
    if DATA_PATH.exists():
        try:
            with open(DATA_PATH, encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return None
    return None


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    today = datetime.date.today()
    monday = today - datetime.timedelta(days=today.weekday())
    date_str = monday.isoformat()
    sunday = monday + datetime.timedelta(days=6)
    week_label = f'{monday.isoformat()} ~ {sunday.isoformat()}'

    log(f'開始更新課表資料，目標週次：{week_label}')

    existing = load_existing()
    existing_by_url = {}
    if existing:
        for s in existing.get('stores', []):
            existing_by_url[s['url']] = s

    try:
        areas, stores = get_areas_and_stores()
    except Exception as e:
        log(f'錯誤：無法取得分廠清單，中止更新。{e}')
        sys.exit(1)

    log(f'找到 {len(stores)} 家分廠、{len(areas)} 個地區')

    area_name_by_id = {a['id']: a['name'] for a in areas}
    result_stores = []
    ok_count = 0
    fail_count = 0

    for i, store in enumerate(stores):
        time.sleep(REQUEST_DELAY_SEC + random.uniform(0, 0.2))
        try:
            classes = get_store_schedule(store['url'], date_str)
            result_stores.append({
                'areaId': store['areaId'],
                'areaName': area_name_by_id.get(store['areaId'], ''),
                'url': store['url'],
                'name': store['name'],
                'classes': classes,
            })
            ok_count += 1
        except Exception as e:
            fail_count += 1
            fallback = existing_by_url.get(store['url'])
            if fallback:
                log(f'警告：{store["name"]} 抓取失敗（{e}），沿用上次資料')
                result_stores.append(fallback)
            else:
                log(f'警告：{store["name"]} 抓取失敗（{e}），且無舊資料可用，此廠將無課表')
                result_stores.append({
                    'areaId': store['areaId'],
                    'areaName': area_name_by_id.get(store['areaId'], ''),
                    'url': store['url'],
                    'name': store['name'],
                    'classes': [],
                })

    total_classes = sum(len(s['classes']) for s in result_stores)

    if ok_count == 0:
        log('錯誤：所有分廠都抓取失敗，保留舊資料，不覆蓋 schedule.json')
        sys.exit(1)

    output = {
        'generatedAt': datetime.datetime.now().isoformat(),
        'weekLabel': week_label,
        'areas': areas,
        'stores': result_stores,
    }

    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

    log(f'更新完成：成功 {ok_count} 家、失敗 {fail_count} 家、共 {total_classes} 堂課')


if __name__ == '__main__':
    main()
