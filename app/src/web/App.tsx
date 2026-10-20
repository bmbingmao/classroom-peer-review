import { useEffect, useState } from 'react';
import { get, post, setUnauthorizedHandler } from './api';
import Login from './pages/Login';
import ChangePwd from './pages/ChangePwd';
import Admin from './pages/Admin';
import AdminStudents from './pages/AdminStudents';
import Account from './pages/Account';
import TeacherActivities from './pages/TeacherActivities';
import TeacherGroups from './pages/TeacherGroups';
import TeacherNew from './pages/TeacherNew';
import TeacherResult from './pages/TeacherResult';
import StudentHome from './pages/StudentHome';
import StudentVote from './pages/StudentVote';
import StudentScore from './pages/StudentScore';
import StudentResult from './pages/StudentResult';
import StudentPoints from './pages/StudentPoints';
import TeacherPoints from './pages/TeacherPoints';
import TeacherAi from './pages/TeacherAi';

function useHash(): string {
  const [hash, setHash] = useState(() => location.hash || '');
  useEffect(() => {
    const onChange = () => setHash(location.hash || '');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

function nav(path: string) {
  if (location.hash === path) return;
  location.hash = path;
}

function homeFor(role: string): string {
  if (role === 'admin') return '#/a';
  if (role === 'teacher') return '#/t/activities';
  return '#/s';
}

const TEACHER_TABS = [
  { path: '#/t/activities', label: '评价项' },
  { path: '#/t/groups', label: '学生组' },
  { path: '#/t/points', label: '积分' },
  { path: '#/t/ai', label: 'AI 审核' },
];

export default function App() {
  const hash = useHash();
  const [user, setUser] = useState<any | null | undefined>(undefined);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    get('/api/auth/me')
      .then((r) => {
        setUser(r.user);
        if (!location.hash) location.hash = r.user.must_change_pwd ? '#/change-pwd' : homeFor(r.user.role);
      })
      .catch(() => setUser(null));
  }, []);

  async function refresh() {
    try {
      const r = await get('/api/auth/me');
      setUser(r.user);
      loc(r.user);
    } catch {
      setUser(null);
    }
  }

  function loc(u: any) {
    nav(u.must_change_pwd ? '#/change-pwd' : homeFor(u.role));
  }

  async function logout() {
    try {
      await post('/api/auth/logout');
    } catch {
      /* ignore */
    }
    setUser(null);
    location.hash = '';
  }

  if (user === undefined) return <div className="spin">加载中…</div>;

  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          loc(u);
        }}
      />
    );

  if (user.must_change_pwd)
    return (
      <ChangePwd
        forced
        onDone={() => {
          refresh();
        }}
      />
    );

  const role = user.role;

  return (
    <>
      <div className="topbar">
        <h1>{role === 'admin' ? '课堂互评 · 管理后台' : role === 'teacher' ? '课堂互评 · 教师端' : '课堂互评'}</h1>
        <span className="who">
          {user.display_name}
          {role === 'student' ? `（${user.username}）` : ''}
        </span>
        <button className="btn btn-sm" style={{ background: 'transparent', color: '#fff', borderColor: 'rgb(255 255 255 / 35%)' }} onClick={logout}>
          退出
        </button>
      </div>

      {role === 'admin' && (
        <div className="nav">
          <a href="#/a" className={hash === '#/a' || hash === '' ? 'active' : ''}>
            管理后台
          </a>
          <a href="#/a/students" className={hash.startsWith('#/a/students') ? 'active' : ''}>
            学生信息
          </a>
          <a href="#/a/account" className={hash.startsWith('#/a/account') ? 'active' : ''}>
            账号设置
          </a>
        </div>
      )}

      {role === 'student' && (
        <div className="nav">
          <a href="#/s" className={hash === '#/s' || hash === '' || hash.startsWith('#/s/') && !hash.startsWith('#/s/points') ? 'active' : ''}>
            我的评价
          </a>
          <a href="#/s/points" className={hash.startsWith('#/s/points') ? 'active' : ''}>
            我的积分
          </a>
          <a href="#/change-pwd" className={hash === '#/change-pwd' ? 'active' : ''}>
            改密码
          </a>
        </div>
      )}

      {role === 'teacher' && (
        <div className="nav">
          {TEACHER_TABS.map((t) => (
            <a key={t.path} href={t.path} className={hash.startsWith(t.path) ? 'active' : ''}>
              {t.label}
            </a>
          ))}
          <a href="#/change-pwd" className={hash === '#/change-pwd' ? 'active' : ''}>
            改密码
          </a>
        </div>
      )}

      <Routes hash={hash} role={role} nav={nav} user={user} refresh={refresh} />
    </>
  );
}

function Routes({ hash, role, nav, user, refresh }: { hash: string; role: string; nav: (p: string) => void; user: any; refresh: () => void }) {
  const clean = hash.replace(/^#/, '');
  const parts = clean.split('/').filter(Boolean);

  if (clean === '/change-pwd') return <ChangePwd onDone={() => nav(homeFor(role))} />;

  if (role === 'admin') {
    if (parts[1] === 'students') return <AdminStudents />;
    if (parts[1] === 'account') return <Account user={user} onChanged={refresh} />;
    return <Admin />;
  }

  if (role === 'teacher') {
    if (parts[0] !== 't') return <TeacherActivities nav={nav} />;
    if (parts[1] === 'groups') return <TeacherGroups />;
    if (parts[1] === 'new' && parts[2] === 'vote') return <TeacherNew type="vote" nav={nav} />;
    if (parts[1] === 'new' && parts[2] === 'score') return <TeacherNew type="score" nav={nav} />;
    if (parts[1] === 'points') return <TeacherPoints />;
    if (parts[1] === 'ai') return <TeacherAi />;
    if (parts[1] === 'result' && parts[2]) return <TeacherResult id={Number(parts[2])} nav={nav} />;
    return <TeacherActivities nav={nav} />;
  }

  // student
  if (parts[0] !== 's') return <StudentHome nav={nav} />;
  if (parts[1] === 'vote' && parts[2]) return <StudentVote id={Number(parts[2])} nav={nav} />;
  if (parts[1] === 'score' && parts[2]) return <StudentScore id={Number(parts[2])} nav={nav} />;
  if (parts[1] === 'result' && parts[2]) return <StudentResult id={Number(parts[2])} nav={nav} />;
  if (parts[1] === 'points') return <StudentPoints nav={nav} />;
  return <StudentHome nav={nav} />;
}
