import { useState } from 'react';

function AuthModal({ onClose, onAuthSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState('');
  const [pendingEmail, setPendingEmail] = useState(''); // 待验证的邮箱
  const [resending, setResending] = useState(false);

  // 重发验证邮件
  const handleResendEmail = async () => {
    setResending(true);
    setMsg('');
    try {
      const { supabase } = await import('../supabaseClient');
      if (!supabase) {
        setMsg('Supabase 未配置，无法发送');
        setResending(false);
        return;
      }
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: pendingEmail,
      });
      if (error) {
        setMsg(error.message);
      } else {
        setMsg('验证邮件已重新发送，请查收邮箱。');
      }
    } catch (err) {
      setMsg(err.message || '发送失败');
    }
    setResending(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMsg('');
    setPendingEmail('');

    try {
      // 动态导入 supabase，避免未配置时报错
      const { supabase } = await import('../supabaseClient');
      if (!supabase) {
        setMsg('Supabase 未配置，无法登录');
        setSubmitting(false);
        return;
      }

      let result;
      if (isLogin) {
        result = await supabase.auth.signInWithPassword({ email, password });
      } else {
        result = await supabase.auth.signUp({ email, password });
      }

      if (result.error) {
        setMsg(result.error.message);
        setSubmitting(false);
        // 登录时如果邮箱未验证，保存邮箱以便重发验证邮件
        if (isLogin && result.error.message?.includes('Email not confirmed')) {
          setPendingEmail(email);
        }
      } else {
        if (!isLogin && result.data?.user && !result.data.session) {
          // 需要邮箱确认
          setPendingEmail(email);
          setMsg('注册成功！请查收邮箱确认链接后登录。');
          setSubmitting(false);
          return;
        }
        setSubmitting(false);
        onAuthSuccess(result.data.user);
      }
    } catch (error) {
      setMsg(error.message || '登录/注册失败');
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        <h2 className="modal-title">{isLogin ? '登录' : '注册'}</h2>
        <p className="modal-subtitle">
          {isLogin ? '登录后即可发布歌曲到平台' : '创建账号，开始发布你的音乐'}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>邮箱</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label>密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="至少 6 位"
              required
              minLength={6}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
          </div>

          {msg && <div className={`auth-msg${msg.includes('成功') ? ' success' : ''}`}>{msg}</div>}

          {pendingEmail && (
            <button
              type="button"
              className="auth-resend"
              onClick={handleResendEmail}
              disabled={resending}
            >
              {resending ? '发送中…' : '重新发送验证邮件'}
            </button>
          )}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? '处理中…' : (isLogin ? '登录' : '注册')}
          </button>
        </form>

        <div className="auth-switch">
          {isLogin ? (
            <>还没有账号？<button onClick={() => { setIsLogin(false); setMsg(''); setPendingEmail(''); }}>注册</button></>
          ) : (
            <>已有账号？<button onClick={() => { setIsLogin(true); setMsg(''); setPendingEmail(''); }}>登录</button></>
          )}
        </div>
      </div>
    </div>
  );
}

export default AuthModal;
