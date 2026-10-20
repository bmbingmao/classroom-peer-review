import { Router } from 'express';
import { all, one, run, tx } from '../db.ts';
import { hashPwd } from '../auth.ts';
import { bad, int, notFound, optStr, str } from '../util.ts';

const router = Router();

/* ---------------- 学生组 ---------------- */

router.get('/groups', (req: any, res) => {
  const rows = all(
    `SELECT g.id, g.name, g.created_at,
            (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count
       FROM groups g WHERE g.teacher_id = ? ORDER BY g.id DESC`,
    req.user.id,
  );
  res.json({ groups: rows });
});

router.post('/groups', (req: any, res) => {
  const name = str(req.body?.name, '组名', 64);
  const r = run('INSERT INTO groups(teacher_id, name, created_at) VALUES(?,?,?)', req.user.id, name, Date.now());
  res.json({ id: Number(r.lastInsertRowid) });
});

router.patch('/groups/:id', (req: any, res) => {
  const g = ownGroup(req.user.id, int(req.params.id, 'id'));
  const name = str(req.body?.name, '组名', 64);
  run('UPDATE groups SET name = ? WHERE id = ?', name, g.id);
  res.json({ ok: true });
});

router.delete('/groups/:id', (req: any, res) => {
  const g = ownGroup(req.user.id, int(req.params.id, 'id'));
  // 组删掉，学生账号保留（见 v2 §3.1），只解除关联
  run('DELETE FROM groups WHERE id = ?', g.id);
  res.json({ ok: true });
});

router.get('/groups/:id/members', (req: any, res) => {
  const g = ownGroup(req.user.id, int(req.params.id, 'id'));
  const rows = all(
    `SELECT u.id, u.username, u.display_name, u.must_change_pwd, u.status
       FROM group_members m JOIN users u ON u.id = m.student_id
      WHERE m.group_id = ? ORDER BY u.username`,
    g.id,
  );
  res.json({ members: rows });
});

/** 批量导入：学号,姓名 每行一条（支持中文逗号/制表符/CSV 带表头） */
router.post('/groups/:id/import', (req: any, res) => {
  const g = ownGroup(req.user.id, int(req.params.id, 'id'));
  const raw = typeof req.body?.text === 'string' ? req.body.text : '';
  if (!raw.trim()) throw bad('没有可导入的内容');

  const lines = raw.split(/\r?\n/);
  const errors: { line: number; message: string }[] = [];
  let added = 0;
  let reused = 0;
  let alreadyInGroup = 0;

  tx(() => {
    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      const t = line.trim();
      if (!t) return;
      // 跳过表头
      if (idx === 0 && /^(学号|student|id)/i.test(t)) return;

      const parts = t.split(/[,，\t]+/).map((s) => s.trim());
      if (parts.length < 2) {
        errors.push({ line: lineNo, message: '格式应为「学号,姓名」' });
        return;
      }
      const username = parts[0];
      const displayName = parts[1];
      if (!username || !displayName) {
        errors.push({ line: lineNo, message: '学号或姓名为空' });
        return;
      }
      if (username.length > 64 || displayName.length > 64) {
        errors.push({ line: lineNo, message: '学号或姓名过长' });
        return;
      }
      if (!/^[0-9A-Za-z_-]+$/.test(username)) {
        errors.push({ line: lineNo, message: '学号只能包含字母、数字、下划线和横线' });
        return;
      }

      let student = one<any>('SELECT id, role FROM users WHERE username = ?', username);
      if (student) {
        if (student.role !== 'student') {
          errors.push({ line: lineNo, message: `账号 ${username} 已存在且不是学生账号` });
          return;
        }
        const linked = one<any>(
          'SELECT 1 AS x FROM teacher_students WHERE teacher_id = ? AND student_id = ?',
          req.user.id,
          student.id,
        );
        if (!linked) {
          run(
            'INSERT INTO teacher_students(teacher_id, student_id, created_at) VALUES(?,?,?)',
            req.user.id,
            student.id,
            Date.now(),
          );
        }
        reused += 1;
      } else {
        const now = Date.now();
        const r = run(
          `INSERT INTO users(role, username, password_hash, display_name, status, must_change_pwd, points_cached, created_at)
           VALUES('student', ?, ?, ?, 'active', 1, 0, ?)`,
          username,
          hashPwd(username), // 初始密码 = 学号
          displayName,
          now,
        );
        student = { id: Number(r.lastInsertRowid), role: 'student' };
        run(
          'INSERT INTO teacher_students(teacher_id, student_id, created_at) VALUES(?,?,?)',
          req.user.id,
          student.id,
          now,
        );
        added += 1;
      }

      const dup = one<any>('SELECT 1 AS x FROM group_members WHERE group_id = ? AND student_id = ?', g.id, student.id);
      if (dup) {
        alreadyInGroup += 1;
      } else {
        run('INSERT INTO group_members(group_id, student_id) VALUES(?,?)', g.id, student.id);
      }
    });
  });

  res.json({ added, reused, alreadyInGroup, errors });
});

router.patch('/groups/:id/members/:studentId', (req: any, res) => {
  const g = ownGroup(req.user.id, int(req.params.id, 'id'));
  const sid = int(req.params.studentId, 'studentId');
  assertMember(g.id, sid);
  const name = str(req.body?.display_name, '姓名', 64);
  run('UPDATE users SET display_name = ? WHERE id = ?', name, sid);
  res.json({ ok: true });
});

/** 移出组（不等于删账号） */
router.delete('/groups/:id/members/:studentId', (req: any, res) => {
  const g = ownGroup(req.user.id, int(req.params.id, 'id'));
  const sid = int(req.params.studentId, 'studentId');
  run('DELETE FROM group_members WHERE group_id = ? AND student_id = ?', g.id, sid);
  res.json({ ok: true });
});

/** 重置密码为学号，下次登录强制改密（会跨教师生效，UI 需提示） */
router.post('/groups/:id/members/:studentId/reset-password', (req: any, res) => {
  const g = ownGroup(req.user.id, int(req.params.id, 'id'));
  const sid = int(req.params.studentId, 'studentId');
  assertMember(g.id, sid);
  const stu = one<any>('SELECT username FROM users WHERE id = ?', sid);
  if (!stu) throw notFound('学生不存在');
  run('UPDATE users SET password_hash = ?, must_change_pwd = 1 WHERE id = ?', hashPwd(stu.username), sid);
  res.json({ ok: true, hint: '已重置为学号，该学生下次登录需重新改密' });
});

/** 我的全部学生（带所属组，界面按组分组显示） */
router.get('/students', (req: any, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const rows = all<any>(
    `SELECT u.id, u.username, u.display_name, u.must_change_pwd, u.points_cached
       FROM teacher_students t JOIN users u ON u.id = t.student_id
      WHERE t.teacher_id = ? AND (? = '' OR u.username LIKE ? OR u.display_name LIKE ?)
      ORDER BY u.username LIMIT 500`,
    req.user.id,
    q,
    `%${q}%`,
    `%${q}%`,
  );

  // 归属组：一次查出来，前端做分组 / 批量添加
  const membership = all<any>(
    `SELECT gm.student_id, g.id, g.name
       FROM group_members gm JOIN groups g ON g.id = gm.group_id
      WHERE g.teacher_id = ?
      ORDER BY g.id`,
    req.user.id,
  );
  const byStudent = new Map<number, { id: number; name: string }[]>();
  for (const m of membership) {
    if (!byStudent.has(m.student_id)) byStudent.set(m.student_id, []);
    byStudent.get(m.student_id)!.push({ id: m.id, name: m.name });
  }

  res.json({
    students: rows.map((u) => ({ ...u, groups: byStudent.get(u.id) ?? [] })),
  });
});

/* ---------------- 文件夹（课程归档） ---------------- */

router.get('/folders', (req: any, res) => {
  res.json({
    folders: all('SELECT * FROM folders WHERE teacher_id = ? ORDER BY id DESC', req.user.id),
  });
});

router.post('/folders', (req: any, res) => {
  const name = str(req.body?.name, '文件夹名', 64);
  const r = run('INSERT INTO folders(teacher_id, name, created_at) VALUES(?,?,?)', req.user.id, name, Date.now());
  res.json({ id: Number(r.lastInsertRowid) });
});

router.patch('/folders/:id', (req: any, res) => {
  const f = ownFolder(req.user.id, int(req.params.id, 'id'));
  if (req.body?.name !== undefined) {
    run('UPDATE folders SET name = ? WHERE id = ?', str(req.body.name, '文件夹名', 64), f.id);
  }
  if (req.body?.archived !== undefined) {
    // 归档：文件夹里的评价项不再出现在学生端，教师端仍可见
    run('UPDATE folders SET archived = ? WHERE id = ?', req.body.archived ? 1 : 0, f.id);
  }
  res.json({ ok: true });
});

router.delete('/folders/:id', (req: any, res) => {
  const f = ownFolder(req.user.id, int(req.params.id, 'id'));
  const action = optStr(req.body?.activities, 'activities', 16) || 'detach';
  if (action === 'delete') {
    run('DELETE FROM activities WHERE folder_id = ? AND teacher_id = ?', f.id, req.user.id);
  } else {
    run('UPDATE activities SET folder_id = NULL WHERE folder_id = ? AND teacher_id = ?', f.id, req.user.id);
  }
  run('DELETE FROM folders WHERE id = ?', f.id);
  res.json({ ok: true });
});

/* ---------------- helpers ---------------- */

function ownGroup(teacherId: number, id: number) {
  const g = one<any>('SELECT * FROM groups WHERE id = ?', id);
  if (!g) throw notFound('学生组不存在');
  if (g.teacher_id !== teacherId) throw bad('无权访问该学生组');
  return g;
}

function ownFolder(teacherId: number, id: number) {
  const f = one<any>('SELECT * FROM folders WHERE id = ?', id);
  if (!f) throw notFound('文件夹不存在');
  if (f.teacher_id !== teacherId) throw bad('无权访问该文件夹');
  return f;
}

function assertMember(groupId: number, studentId: number) {
  const m = one<any>('SELECT 1 AS x FROM group_members WHERE group_id = ? AND student_id = ?', groupId, studentId);
  if (!m) throw notFound('该学生不在本组');
}

export default router;
