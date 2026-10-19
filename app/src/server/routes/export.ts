import ExcelJS from 'exceljs';
import { Router } from 'express';
import { all, one, run } from '../db.ts';
import { int } from '../util.ts';
import { activityItems, effectiveStatus, getActivityForTeacher, invitedStudentIds } from '../lib.ts';
import { trimmedMean, weightedTotal } from '../scoring.ts';

const router = Router();

const STATUS_TEXT: Record<string, string> = { pending: '未开始', open: '进行中', ended: '已截止', closed: '已关闭' };

router.get('/activities/:id/export', async (req: any, res, next) => {
  try {
    const a = getActivityForTeacher(int(req.params.id, 'id'), req.user.id);
    const wb = await buildWorkbook(a);

    // 导出含真实身份 → 必须留痕
    run(
      'INSERT INTO export_logs(teacher_id, activity_id, include_identity, created_at) VALUES(?,?,?,?)',
      req.user.id,
      a.id,
      1,
      Date.now(),
    );

    const buf = await wb.xlsx.writeBuffer();
    const name = safeName(`${a.title}_${stamp()}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
});

/** 导出记录（谁知道导过什么） */
router.get('/exports', (req: any, res) => {
  res.json({
    logs: all<any>(
      `SELECT e.*, a.title FROM export_logs e LEFT JOIN activities a ON a.id = e.activity_id
        WHERE e.teacher_id = ? ORDER BY e.id DESC LIMIT 100`,
      req.user.id,
    ),
  });
});

/* ==================== 组装工作簿 ==================== */

async function buildWorkbook(a: any): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '课堂互评系统';
  wb.created = new Date();

  const invited = invitedStudentIds(a.id);
  const submitted =
    a.type === 'vote'
      ? new Set(all<{ student_id: number }>('SELECT student_id FROM vote_ballots WHERE activity_id = ?', a.id).map((r) => r.student_id))
      : new Set(all<{ student_id: number }>('SELECT student_id FROM score_submissions WHERE activity_id = ?', a.id).map((r) => r.student_id));

  /* 1. 概览 */
  const overview = wb.addWorksheet('活动概览');
  overview.columns = [
    { header: '项目', key: 'k', width: 18 },
    { header: '内容', key: 'v', width: 60 },
  ];
  const rows: [string, any][] = [
    ['标题', a.title],
    ['类型', a.type === 'vote' ? '投票' : '评分'],
    ['状态', STATUS_TEXT[effectiveStatus(a)] ?? a.status],
    ['开始时间', fmt(a.start_at)],
    ['截止时间', fmt(a.end_at)],
    ['匿名', a.anonymous ? '是（学生之间匿名）' : '否'],
    ['应参与人数', invited.size],
    ['已提交人数', submitted.size],
    ['参与率', invited.size ? `${Math.round((submitted.size / invited.size) * 100)}%` : '—'],
    ['本次导出含真实姓名学号', '是（已记录导出人）'],
    ['导出时间', fmt(Date.now())],
    ['导出人', one<any>('SELECT display_name FROM users WHERE id = ?', a.teacher_id)?.display_name ?? ''],
  ];
  for (const [k, v] of rows) overview.addRow({ k, v });
  overview.getRow(1).font = { bold: true };

  /* 2. 参评名单（投票另附明细） */
  const people = all<any>(
    `SELECT u.id, u.display_name, u.username FROM users u
      WHERE u.id IN (${[...invited].map(() => '?').join(',') || 'NULL'}) ORDER BY u.username`,
    ...invited,
  );

  if (a.type === 'vote') {
    const sheet = wb.addWorksheet('投票明细');
    sheet.columns = [
      { header: '选项', key: 'opt', width: 32 },
      { header: '票数', key: 'count', width: 10 },
      { header: '当前最高', key: 'top', width: 10 },
    ];
    const options = all<any>('SELECT id, text FROM vote_options WHERE activity_id = ? ORDER BY sort, id', a.id);
    const counts = new Map<number, number>(options.map((o) => [o.id, 0]));
    for (const b of all<any>('SELECT option_ids FROM vote_ballots WHERE activity_id = ?', a.id)) {
      for (const id of parseIds(b.option_ids)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const max = Math.max(0, ...counts.values());
    for (const o of options) {
      sheet.addRow({ opt: o.text, count: counts.get(o.id) ?? 0, top: (counts.get(o.id) ?? 0) === max && max > 0 ? '👑' : '' });
    }
    sheet.getRow(1).font = { bold: true };

    if (!a.anonymous) {
      const detail = wb.addWorksheet('投票人名单');
      detail.columns = [
        { header: '学号', key: 'username', width: 16 },
        { header: '姓名', key: 'name', width: 12 },
        { header: '选项', key: 'choice', width: 40 },
      ];
      const ballots = all<any>('SELECT student_id, option_ids FROM vote_ballots WHERE activity_id = ?', a.id);
      const optText = new Map(options.map((o) => [o.id, o.text]));
      for (const b of ballots) {
        const s = people.find((p) => p.id === b.student_id);
        detail.addRow({
          username: s?.username ?? '',
          name: s?.display_name ?? '',
          choice: parseIds(b.option_ids).map((id) => optText.get(id) ?? id).join('、'),
        });
      }
      detail.getRow(1).font = { bold: true };
    }
  }

  /* 3~4. 评分 */
  const items = activityItems(a.id);
  const targets = a.type === 'score'
    ? all<any>('SELECT id, anon_label, student_id FROM score_targets WHERE activity_id = ? ORDER BY sort, id', a.id)
    : [];
  const records = a.type === 'score'
    ? all<any>('SELECT target_id, item_id, student_id, score FROM score_records WHERE activity_id = ?', a.id)
    : [];

  let trimmedResults: {
    targetId: number;
    label: string;
    itemId: number;
    n: number;
    k: number;
    mean: number | null;
    rawMean: number | null;
    removedLow: number[];
    removedHigh: number[];
  }[] = [];
  let totals = new Map<number, number | null>();

  if (a.type === 'score') {
    // 先算极值，原始分明细里要标注
    const marks = new Map<string, 'low' | 'high'>(); // `${targetId}:${itemId}:${judgeId}`
    trimmedResults = [];
    for (const t of targets) {
      const perItem: { itemId: number; weight: number; mean: number | null }[] = [];
      for (const it of items) {
        const entries = records
          .filter((r) => r.target_id === t.id && r.item_id === it.id)
          .map((r) => ({ studentId: r.student_id, score: r.score }));
        const r = trimmedMean(entries);
        for (const e of r.removedLow) marks.set(`${t.id}:${it.id}:${e.studentId}`, 'low');
        for (const e of r.removedHigh) marks.set(`${t.id}:${it.id}:${e.studentId}`, 'high');
        trimmedResults.push({
          targetId: t.id,
          label: t.anon_label,
          itemId: it.id,
          n: r.n,
          k: r.k,
          mean: r.mean,
          rawMean: r.rawMean,
          removedLow: r.removedLow.map((e) => e.score),
          removedHigh: r.removedHigh.map((e) => e.score),
        });
        perItem.push({ itemId: it.id, weight: it.weight, mean: r.mean });
      }
      totals.set(t.id, weightedTotal(perItem));
    }

    /* 3. 原始分明细 */
    const raw = wb.addWorksheet('评分原始分明细');
    const header = ['被评对象', '真实对应学生', '评委学号', '评委姓名', ...items.map((it) => it.name), '备注'];
    raw.addRow(header);
    raw.getRow(1).font = { bold: true };
    const byJudge = new Map<string, { targetId: number; judgeId: number; scores: Map<number, number>; marks: string[] }>();
    for (const r of records) {
      const key = `${r.target_id}:${r.student_id}`;
      if (!byJudge.has(key)) byJudge.set(key, { targetId: r.target_id, judgeId: r.student_id, scores: new Map(), marks: [] });
      const row = byJudge.get(key)!;
      row.scores.set(r.item_id, r.score);
      const m = marks.get(`${r.target_id}:${r.item_id}:${r.student_id}`);
      if (m) row.marks.push(`${itemName(items, r.item_id)}被剔除(${m === 'low' ? '最低' : '最高'})`);
    }
    for (const row of byJudge.values()) {
      const t = targets.find((x) => x.id === row.targetId);
      const judge = people.find((p) => p.id === row.judgeId);
      const owner = t?.student_id ? one<any>('SELECT display_name, username FROM users WHERE id = ?', t.student_id) : null;
      raw.addRow([
        t?.anon_label ?? '',
        owner ? `${owner.display_name}(${owner.username})` : '',
        judge?.username ?? '',
        judge?.display_name ?? '',
        ...items.map((it) => row.scores.get(it.id) ?? ''),
        row.marks.join('；'),
      ]);
    }
    // 高亮被剔除的单元格
    raw.eachRow((cellRow, rowNumber) => {
      if (rowNumber === 1) return;
      const remark = String(cellRow.getCell(header.length).value ?? '');
      if (remark) {
        cellRow.getCell(header.length).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
      }
    });

    /* 4. 去极值结果 */
    const result = wb.addWorksheet('去极值结果');
    result.addRow(['被评对象', '真实对应学生', '评分项', '权重', '有效人数 n', '两端各剔 k', '去极值均分', '原始均分', '剔除的最低分', '剔除的最高分']);
    result.getRow(1).font = { bold: true };
    for (const t of targets) {
      const owner = t.student_id ? one<any>('SELECT display_name, username FROM users WHERE id = ?', t.student_id) : null;
      for (const it of items) {
        const r = trimmedResults.find((x) => x.targetId === t.id && x.itemId === it.id);
        if (!r) continue;
        result.addRow([
          t.anon_label,
          owner ? `${owner.display_name}(${owner.username})` : '',
          it.name,
          it.weight,
          r.n,
          r.k,
          r.mean === null ? '' : round2(r.mean),
          r.rawMean === null ? '' : round2(r.rawMean),
          r.removedLow.join('、'),
          r.removedHigh.join('、'),
        ]);
      }
      result.addRow([t.anon_label, owner ? `${owner.display_name}(${owner.username})` : '', '【加权总分】', '', '', '', totals.get(t.id) ?? '', '', '', '']);
      result.lastRow!.font = { bold: true };
    }
  }

  /* 5. 评语 */
  const comments = wb.addWorksheet('评语表');
  comments.columns = [
    { header: '评语', key: 'content', width: 50 },
    { header: '审核状态', key: 'status', width: 10 },
    { header: 'AI 类别', key: 'cat', width: 10 },
    { header: '驳回原因', key: 'reason', width: 20 },
    { header: '折叠', key: 'folded', width: 8 },
    { header: '👍', key: 'like', width: 6 },
    { header: '🚨', key: 'alarm', width: 6 },
    { header: '作者学号', key: 'username', width: 16 },
    { header: '作者姓名', key: 'name', width: 12 },
    { header: '时间', key: 'time', width: 18 },
  ];
  comments.getRow(1).font = { bold: true };
  const cs = all<any>(
    `SELECT c.*, u.display_name, u.username FROM comments c LEFT JOIN users u ON u.id = c.student_id
      WHERE c.activity_id = ? ORDER BY c.id`,
    a.id,
  );
  for (const c of cs) {
    const counts = all<{ emoji: string; n: number }>('SELECT emoji, COUNT(*) AS n FROM reactions WHERE comment_id = ? GROUP BY emoji', c.id);
    comments.addRow({
      content: c.content,
      status: { approved: '已通过', pending: '待审', rejected: '已驳回' }[c.moderation_status as 'approved' | 'pending' | 'rejected'],
      cat: c.ai_category,
      reason: c.reject_reason,
      folded: c.folded ? '是' : '',
      like: counts.find((x) => x.emoji === '👍')?.n ?? 0,
      alarm: counts.find((x) => x.emoji === '🚨')?.n ?? 0,
      username: c.username,
      name: c.display_name,
      time: fmt(c.created_at),
    });
  }

  /* 6. 积分 */
  const points = wb.addWorksheet('积分表');
  points.columns = [
    { header: '学号', key: 'username', width: 16 },
    { header: '姓名', key: 'name', width: 12 },
    { header: '是否参与本次', key: 'joined', width: 14 },
    { header: '当前总积分', key: 'points', width: 12 },
    { header: '本次积分变动', key: 'delta', width: 14 },
  ];
  points.getRow(1).font = { bold: true };
  for (const p of people) {
    const u = one<any>('SELECT points_cached FROM users WHERE id = ?', p.id);
    const delta =
      one<{ s: number }>('SELECT COALESCE(SUM(delta), 0) AS s FROM point_ledger WHERE student_id = ? AND activity_id = ?', p.id, a.id)?.s ?? 0;
    points.addRow({
      username: p.username,
      name: p.display_name,
      joined: submitted.has(p.id) ? '是' : '否',
      points: u?.points_cached ?? 0,
      delta,
    });
  }

  /* 流水另开一张 */
  const ledger = wb.addWorksheet('积分流水');
  ledger.columns = [
    { header: '学号', key: 'username', width: 16 },
    { header: '姓名', key: 'name', width: 12 },
    { header: '变动', key: 'delta', width: 8 },
    { header: '原因', key: 'reason', width: 30 },
    { header: '时间', key: 'time', width: 18 },
  ];
  ledger.getRow(1).font = { bold: true };
  const ls = all<any>(
    `SELECT l.*, u.display_name, u.username FROM point_ledger l JOIN users u ON u.id = l.student_id
      WHERE l.activity_id = ? ORDER BY l.id`,
    a.id,
  );
  for (const l of ls) {
    ledger.addRow({ username: l.username, name: l.display_name, delta: l.delta, reason: l.reason, time: fmt(l.created_at) });
  }

  for (const ws of wb.worksheets) {
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return wb;
}

/* ==================== helpers ==================== */

function parseIds(json: string): number[] {
  try {
    return JSON.parse(json) as number[];
  } catch {
    return [];
  }
}

function itemName(items: any[], id: number) {
  return items.find((i) => i.id === id)?.name ?? `#${id}`;
}

function round2(x: number) {
  return Math.round(x * 100) / 100;
}

function fmt(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

export default router;
