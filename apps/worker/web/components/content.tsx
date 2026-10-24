import { useState } from 'react';
import { Link } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Artifact, Evidence } from '../api';

export function Download({ text, filename, href, format = 'Markdown' }: { text: string; filename: string; href?: string; format?: 'Markdown' | 'JSON' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    setBusy(true); setError('');
    try {
      let blob: Blob;
      if (href) {
        const response = await fetch(href, { credentials: 'same-origin' });
        if (!response.ok) {
          const body = await response.json();
          throw new Error(body.error?.message ?? '원문을 내려받지 못했습니다.');
        }
        blob = await response.blob();
      } else blob = new Blob([text], { type: `${format === 'JSON' ? 'application/json' : 'text/markdown'};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = filename; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '다운로드에 실패했습니다.'); }
    finally { setBusy(false); }
  }
  return <><button type="button" onClick={() => void download()} disabled={busy}>{busy ? '다운로드 중…' : `${format} 다운로드`}</button>{error && <p role="alert" className="notice error">{error}</p>}</>;
}

export function MarkdownBody({ markdown, links = [] }: { markdown: string; links?: Artifact[] }) {
  const properties = markdown.match(/^\uFEFF?---\r?\n([\w-]+:[\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return <div className="markdown-body">{properties && <details className="document-properties"><summary>문서 속성</summary><pre>{properties[1]}</pre></details>}<Markdown remarkPlugins={[[remarkGfm, { singleTilde: false }]]} components={{
    table: ({ children }) => <div className="markdown-table" tabIndex={0} role="region" aria-label="문서 표"><table>{children}</table></div>,
    img: ({ alt }) => <span className="muted">[이미지: {alt || '설명 없음'} · 자동 불러오기 꺼짐]</span>,
    a: ({ href, children }) => {
      if (!href) return <span>{children}</span>;
      if (/^(https?:\/\/|mailto:)/i.test(href)) return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
      if (/^[/\\]{2}|^[a-z][a-z\d+.-]*:/i.test(href)) return <span>{children}</span>;
      let path: string;
      try { path = decodeURIComponent(href.split(/[?#]/)[0]); } catch { return <span>{children}</span>; }
      const code = path.split('/').pop()?.replace(/\.md$/i, '');
      const known = code && links.find(item => item.documentCode === code);
      return known ? <Link to={`/${known.kind === 'record' ? 'records' : 'documents'}/${encodeURIComponent(known.id)}`}>{children}</Link> : <span title={href}>{children}</span>;
    },
  }}>{properties ? markdown.slice(properties[0].length) : markdown}</Markdown></div>;
}

export function Source({ markdown, citation, sourceHash, links, filename = 'document.md', downloadUrl, exportText }: { markdown: string; citation?: Evidence; sourceHash?: string; links?: Artifact[]; filename?: string; downloadUrl?: string; exportText?: string }) {
  const [raw, setRaw] = useState(Boolean(citation));
  const lines = markdown.split('\n');
  const exactLines = new Set<number>();
  const quote = citation?.quote;
  if (quote && (citation?.sourceSha256 ?? citation?.sourceHash) === sourceHash && sourceHash) {
    const quoteLines = quote.split('\n');
    for (let start = 0; start <= lines.length - quoteLines.length; start++) {
      if (lines.slice(start, start + quoteLines.length).join('\n') === quote) {
        for (let offset = 0; offset < quoteLines.length; offset++) exactLines.add(start + offset);
      }
    }
  }
  return <div className="content-viewer">
    <div className="content-toolbar"><div className="view-switch" role="group" aria-label="문서 표시 방식"><button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>읽기 보기</button><button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>원문 보기</button></div><Download text={exportText ?? markdown} filename={filename} href={downloadUrl}/></div>
    {citation && <p className="muted">{exactLines.size ? `원문·해시 일치 위치 ${exactLines.size}행${raw ? '' : ' · 원문 보기에서 강조 위치를 확인하세요.'}` : '인용과 원문·해시가 일치하지 않아 강조하지 않습니다.'}</p>}
    <div className={`source ${raw ? 'source-raw' : 'source-rendered'}`} aria-label="Markdown 원문">{raw ? lines.map((line, i) => <div className={`source-line${exactLines.has(i) ? ' highlighted' : ''}`} key={i}><span className="line-number" aria-hidden="true">{i + 1}</span><span>{line || ' '}</span></div>) : <MarkdownBody markdown={markdown} links={links}/>}</div>
  </div>;
}

const fieldLabels: Record<string, string> = {
  id: 'ID', title: '제목', name: '이름', label: '이름', type: '유형', kind: '종류', status: '상태', state: '상태', reason: '사유', message: '내용', description: '설명',
  releaseId: '지식 릴리스', dataRevision: '자료 세대', authorityRevision: '권한 세대', rulesHash: '규칙 해시', schemaHash: '스키마 해시', context: '조회 기준',
  queryId: '조회 ID', operation: '조회 종류', computedAt: '계산 시각', targetIds: '조회 대상', entities: '대상 목록', relations: '관계 목록', paths: '근거 경로',
  totalEntities: '전체 대상 수', totalRelations: '전체 관계 수', excluded: '제외된 항목', unknown: '미확인 사항', missing: '연결 미확인', impactSet: '영향 대상',
  subjectId: '출발 대상', objectId: '도착 대상', nodeIds: '경로 대상', relationIds: '경로 관계', derived: '도출 여부', evidenceRefs: '인용 근거',
  revisionId: '원문 버전', artifactId: '자료 ID', sourceSha256: '원본 해시', sourceHash: '원본 해시', quote: '인용문', lineStart: '시작 행', lineEnd: '종료 행',
  engine: '계산 엔진', version: '버전', cursor: '다음 조회 위치', displayRange: '표시 범위', start: '시작', end: '종료',
  allowed: '허용 여부', valid: '유효 여부', action: '동작', actions: '동작 권한', policyIds: '권한 근거', roleId: '역할', personId: '직원', scope: '범위',
  validFrom: '시작일', validUntil: '종료일', recordTypeId: '기록 유형', resourceTypeId: '대상 유형', condition: '조건', conditions: '조건', stateCondition: '상태 조건', separationCondition: '직무 분리 조건',
  origin: '출처 구분', reviewStatus: '검토 상태', createdAt: '등록 시각', metadata: '상세 정보', assignments: '역할 지정', errors: '오류', warnings: '주의 사항',
};
function fieldLabel(key: string) { return Object.hasOwn(fieldLabels, key) ? fieldLabels[key] : key; }

export function DataValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="muted">미제공</span>;
  if (typeof value === 'boolean') return <span className="data-boolean">{value ? '예' : '아니요'}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="muted">항목 없음</span>;
    const rows = value.every(item => item !== null && typeof item === 'object' && !Array.isArray(item)) ? value as Record<string, unknown>[] : null;
    const columns = rows ? [...new Set(rows.flatMap(row => Object.keys(row)))] : [];
    if (rows && columns.length > 0 && columns.length <= 6 && rows.every(row => Object.values(row).every(cell => cell === null || typeof cell !== 'object'))) {
      return <div className="data-table" tabIndex={0} role="region" aria-label="결과 표"><table><thead><tr>{columns.map(key => <th scope="col" key={key}>{fieldLabel(key)}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{columns.map(key => <td key={key}><DataValue value={Object.hasOwn(row, key) ? row[key] : undefined}/></td>)}</tr>)}</tbody></table></div>;
    }
    return <ol className="data-list">{value.map((item, i) => <li key={i}><DataValue value={item}/></li>)}</ol>;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return <span className="muted">항목 없음</span>;
    return <dl className="data-fields">{entries.map(([key, item]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd>{key === 'markdown' && typeof item === 'string' ? <Source markdown={item}/> : <DataValue value={item}/>}</dd></div>)}</dl>;
  }
  return <span className="data-text">{value === '' ? '빈 문자열' : String(value)}</span>;
}

export function ResultDetails({ value, title = '조회 기준과 세부 정보', open = false, filename = 'result.json' }: { value: unknown; title?: string; open?: boolean; filename?: string }) {
  const [raw, setRaw] = useState(false);
  const [expanded, setExpanded] = useState(open);
  return <details className="result-details" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>{title}</summary>{expanded && <><div className="content-toolbar"><div className="view-switch" role="group" aria-label={`${title} 표시 방식`}><button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>정리된 보기</button><button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>JSON 원문 보기</button></div><Download text={JSON.stringify(value, null, 2) ?? 'null'} filename={filename} format="JSON"/></div>{raw ? <pre className="json-view">{JSON.stringify(value, null, 2) ?? 'null'}</pre> : <DataValue value={value}/>}</>}</details>;
}
