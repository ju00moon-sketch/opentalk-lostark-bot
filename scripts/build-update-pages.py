# docs/updates.html(전체 노트)의 <article>들을 읽어 버전별 페이지 docs/updates/<파일>.html을 다시 만든다.
# 새 버전을 낼 때: updates.html에 <article id="..."> 추가 → 아래 VERSIONS에 한 줄 추가 → python scripts/build-update-pages.py
# 버전 페이지에는 그 버전 노트 하나 + 이전/다음 글 + 전체 목록(게시판식)만 들어간다.
import re
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / 'docs'

# 최신이 위. id = updates.html의 article id, file = 버전 페이지 파일명
VERSIONS = [
    {'id': 'v1-1',       'file': 'v1.1.html',       'badge': 'v1.1', 'title': '길드원 랭킹 추가',  'date': '2026. 09. 02'},
    {'id': '2026-08-31', 'file': '2026-08-31.html', 'badge': '기능',  'title': '캐릭터 분석 확장',  'date': '2026. 08. 31'},
    {'id': 'v0-1',       'file': 'v0.1.html',       'badge': 'v0.1', 'title': '첫 공개',          'date': '2026. 08. 30'},
]

HEAD = '''<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gowun+Dodum&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌱</text></svg>">
<link rel="stylesheet" href="../updates.css">'''


def main():
    src = (DOCS / 'updates.html').read_text(encoding='utf-8')
    articles = dict(
        (aid, html) for html, aid in re.findall(r'(  <article class="release" id="([^"]+)">.*?</article>\n)', src, re.S)
    )
    missing = [v['id'] for v in VERSIONS if v['id'] not in articles]
    assert not missing, f'updates.html에 없는 article id: {missing}'

    (DOCS / 'updates').mkdir(exist_ok=True)
    for i, v in enumerate(VERSIONS):
        newer = VERSIONS[i - 1] if i > 0 else None          # 다음 글 = 더 최신
        older = VERSIONS[i + 1] if i + 1 < len(VERSIONS) else None  # 이전 글 = 더 예전

        def pager_link(target, kind):
            if not target:
                return f'    <span class="pager-item empty" aria-hidden="true"></span>\n'
            return (f'    <a class="pager-item {kind}" href="{target["file"]}">'
                    f'<span class="k">{"이전 글" if kind == "prev" else "다음 글"}</span>'
                    f'<span class="t">{target["badge"]} · {target["title"]}</span></a>\n')

        rows = ''.join(
            f'    <a class="row{" current" if r is v else ""}" href="{r["file"]}">'
            f'<span class="badge">{r["badge"]}</span><span class="title">{r["title"]}</span>'
            f'<span class="date">{r["date"]}</span></a>\n'
            for r in VERSIONS
        )

        page = f'''<!DOCTYPE html>
<html lang="ko">
<head>
{HEAD}
<title>{v["badge"]} {v["title"]} — 포근해용 업데이트 노트</title>
<meta name="description" content="포근해용 {v["badge"]} 업데이트 노트 ({v["date"]}) — {v["title"]}.">
</head>
<body>

<header>
  <div class="wrap">
    <div class="nav-row">
      <a class="back" href="../index.html#updates">← 포근해용 홈으로</a>
      <a class="back" href="../updates.html">전체 노트 보기 →</a>
    </div>
    <h1>업데이트 <span class="accent">노트</span></h1>
    <p class="lead">{v["badge"]} · {v["date"]}</p>
  </div>
</header>

<main class="wrap">

{articles[v["id"]]}
  <nav class="pager" aria-label="이전 · 다음 글">
{pager_link(older, "prev")}{pager_link(newer, "next")}  </nav>

  <section class="board" aria-label="전체 업데이트 목록">
    <div class="board-head">전체 업데이트</div>
{rows}  </section>

</main>

<footer>
  <div class="wrap">
    <p>🌱 <a href="../index.html">포근해용 홈</a> · <a href="../updates.html">전체 업데이트 노트</a> · <a href="https://github.com/ju00moon-sketch/opentalk-lostark-bot">GitHub</a> · MIT License</p>
  </div>
</footer>

</body>
</html>
'''
        (DOCS / 'updates' / v['file']).write_text(page, encoding='utf-8')
        print('wrote', f'docs/updates/{v["file"]}')


if __name__ == '__main__':
    main()
