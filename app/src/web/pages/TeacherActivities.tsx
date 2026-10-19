import { useEffect, useState } from 'react';
import { del, fmtTime, get, patch, post, reportError, statusClass, STATUS_TEXT, toast } from '../api';

export default function TeacherActivities({ nav }: { nav: (p: string) => void }) {
  const [list, setList] = useState<any[] | null>(null);
  const [filter, setFilter] = useState('');
  const [folders, setFolders] = useState<any[]>([]);
  const [folderFilter, setFolderFilter] = useState<string>('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const q = folderFilter === 'none' ? '?folderId=none' : folderFilter ? `?folderId=${folderFilter}` : '';
    get(`/api/teacher/activities${q}`)
      .then((r) => setList(r.activities))
      .catch((e) => {
        reportError(e);
        setList([]);
      });
  }, [tick, folderFilter]);

  useEffect(() => {
    get('/api/teacher/folders')
      .then((r) => setFolders(r.folders))
      .catch(() => setFolders([]));
  }, [tick]);

  async function createFolder() {
    const name = prompt('文件夹名（按课程分类，例如 2026春-计算机基础）');
    if (!name?.trim()) return;
    try {
      await post('/api/teacher/folders', { name: name.trim() });
      toast('已创建');
      setTick((t) => t + 1);
    } catch (e) {
      reportError(e);
    }
  }

  async function moveTo(a: any, folderId: string) {
    try {
      await patch(`/api/teacher/activities/${a.id}`, { folderId: folderId === '' ? null : Number(folderId) });
      toast('已移动');
      setTick((t) => t + 1);
    } catch (e) {
      reportError(e);
    }
  }

  async function close(a: any) {
    if (!confirm(`确定关闭「${a.title}」？关闭后学生不能再提交。`)) return;
    try {
      await patch(`/api/teacher/activities/${a.id}`, { status: 'closed' });
      toast('已关闭');
      setTick((t) => t + 1);
    } catch (e) {
      reportError(e);
    }
  }

  async function remove(a: any) {
    if (!confirm(`删除「${a.title}」？所有提交与评分会一起删除，不可恢复。`)) return;
    try {
      await del(`/api/teacher/activities/${a.id}`);
      toast('已删除');
      setTick((t) => t + 1);
    } catch (e) {
      reportError(e);
    }
  }

  const shown = (list ?? []).filter((a) => !filter || a.type === filter);

  return (
    <div className="container">
      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="row">
          <button className="btn btn-primary" onClick={() => nav('#/t/new/score')}>
            + 发起评分
          </button>
          <button className="btn" onClick={() => nav('#/t/new/vote')}>
            + 发起投票
          </button>
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={createFolder}>
            + 文件夹
          </button>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)' }}>
            <option value="">全部类型</option>
            <option value="score">只要评分</option>
            <option value="vote">只要投票</option>
          </select>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12, gap: 6 }}>
        {[
          ['', '全部'],
          ['none', '未分类'],
          ...folders.map((f: any) => [String(f.id), `${f.name}${f.archived ? '（归档）' : ''}`]),
        ].map(([key, label]) => (
          <a
            key={key as string}
            href="javascript:void 0"
            onClick={(e) => {
              e.preventDefault();
              setFolderFilter(key as string);
            }}
            className={`btn btn-sm`}
            style={{
              background: folderFilter === key ? 'var(--brand-soft)' : '#fff',
              borderColor: folderFilter === key ? 'var(--brand-2)' : 'var(--line)',
              textDecoration: 'none',
            }}
          >
            {label}
          </a>
        ))}
      </div>

      {folderFilter && folderFilter !== 'none' && (() => {
        const f = folders.find((x: any) => String(x.id) === folderFilter);
        if (!f) return null;
        return (
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="muted">当前文件夹：{f.name}{f.archived ? '（已归档，学生端看不到）' : ''}</span>
            <button
              className="btn btn-sm"
              onClick={async () => {
                if (!confirm(f.archived ? `取消归档「${f.name}」？学生端会重新看到。` : `归档「${f.name}」？里面的评价项会从学生端隐藏。`)) return;
                try {
                  await patch(`/api/teacher/folders/${f.id}`, { archived: !f.archived });
                  toast(f.archived ? '已取消归档' : '已归档');
                  setTick((t) => t + 1);
                } catch (e) {
                  reportError(e);
                }
              }}
            >
              {f.archived ? '取消归档' : '归档此文件夹'}
            </button>
          </div>
        );
      })()}

      {list === null && <div className="spin">加载中…</div>}
      {list !== null && shown.length === 0 && (
        <div className="card empty">
          还没有评价项。
          <br />
          先建好学生组，再发起一次评分或投票。
        </div>
      )}

      <div className="grid">
        {shown.map((a) => (
          <div key={a.id} className="card" style={{ marginBottom: 0 }}>
            <div className="spread" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{a.title}</div>
                <div className="row" style={{ gap: 6 }}>
                  <span className={`badge ${a.type === 'vote' ? 'badge-pending' : 'badge-type'}`}>
                    {a.type === 'vote' ? '投票' : '评分'}
                  </span>
                  <span className={statusClass(a.effective)}>{STATUS_TEXT[a.effective]}</span>
                  {a.anonymous ? <span className="badge badge-ended">匿名</span> : null}
                </div>
              </div>
            </div>
            <div className="muted" style={{ margin: '10px 0' }}>
              已交 <b>{a.submittedCount}</b> / {a.invitedCount} 人 · 截止 {fmtTime(a.end_at)}
            </div>
            <div style={{ marginBottom: 10 }}>
              <select
                value={a.folder_id ?? ''}
                onChange={(e) => moveTo(a, e.target.value)}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 13 }}
              >
                <option value="">未分类</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.archived ? '（已归档）' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <button className="btn btn-sm btn-primary" onClick={() => nav(`#/t/result/${a.id}`)}>
                结果 / 二维码
              </button>
              {a.effective === 'open' && (
                <button className="btn btn-sm" onClick={() => close(a)}>
                  关闭
                </button>
              )}
              <button className="btn btn-sm btn-danger" onClick={() => remove(a)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
